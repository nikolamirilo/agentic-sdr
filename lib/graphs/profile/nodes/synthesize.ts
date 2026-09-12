import { z } from "zod";
import { generateJson } from "@/lib/llm";
import {
  CriterionSchema,
  DisqualifierSchema,
  DomainKnowledgeSchema,
  DomainTermSchema,
  IcpSchema,
  ProductDefinitionSchema,
  type DomainTerm,
} from "@/lib/types";
import { insertProfileVersion, recordBillingEvent } from "@/lib/db/queries";
import type { ProfileState, ProfileUpdate, RawSource } from "@/lib/graphs/profile/state";

const MAX_CONTEXT_CHARS = 90_000;

/** Sources rendered with their URLs, because later nodes must cite evidence. */
function renderSources(sources: RawSource[], limit = MAX_CONTEXT_CHARS): string {
  const chunks: string[] = [];
  let used = 0;
  for (const source of sources) {
    const header = `--- source (${source.kind}) ${source.uri} ---`;
    const budget = Math.max(0, limit - used - header.length);
    if (budget < 500) break;
    const body = source.text.slice(0, Math.min(budget, 14_000));
    chunks.push(`${header}\n${body}`);
    used += header.length + body.length;
  }
  return chunks.join("\n\n");
}

const SYSTEM = `You build the research profile that a sales development agent will run on.

Rules that matter more than fluency:
- Ground every claim in the supplied sources. If the sources do not say it, do not write it.
- Prefer the vocabulary the sources actually use over generic business language.
- Be specific enough that a stranger could use this to tell a good prospect from a bad one.
- Never invent customer names, metrics, funding or logos.`;

export async function extractProductDefinition(state: ProfileState): Promise<ProfileUpdate> {
  if (state.rawSources.length === 0) {
    return { errors: ["extract_product_definition: no sources were readable"] };
  }
  const productDefinition = await generateJson({
    schema: ProductDefinitionSchema,
    system: SYSTEM,
    prompt: `Describe this product from its own material.

Product name as registered: ${state.productName}
${state.websiteUrl ? `Website: ${state.websiteUrl}` : ""}

${renderSources(state.rawSources)}`,
  });
  return { productDefinition };
}

export async function deriveIcp(state: ProfileState): Promise<ProfileUpdate> {
  if (!state.productDefinition) return { errors: ["derive_icp: no product definition"] };

  const result = await generateJson({
    schema: z.object({ icp: IcpSchema, domainKnowledge: DomainKnowledgeSchema }),
    system: SYSTEM,
    prompt: `Derive the ideal customer profile and the surrounding domain knowledge.

The ICP must be narrow enough to search against. "Companies that want to grow" is useless;
"Series A to C DTC brands running paid social in-house" is usable.

Trigger signals must be things observable on a company's public footprint: a job post,
a funding announcement, a stack change, a new market. Not internal states.

exampleCustomerUrls: only URLs that appear in the sources as actual customers. Empty is fine.

# Product definition
${JSON.stringify(state.productDefinition, null, 2)}

# Sources
${renderSources(state.rawSources, 60_000)}`,
  });

  return { icp: result.icp, domainKnowledge: result.domainKnowledge };
}

/**
 * The differentiating field, so it gets real evidence. A term survives only if
 * it appears verbatim in scraped source text, and it carries the URL it was
 * seen on. Without this the field degenerates into marketing vocabulary.
 */
export async function deriveDomainLanguage(state: ProfileState): Promise<ProfileUpdate> {
  if (state.rawSources.length === 0) return { domainLanguage: [] };

  const candidateTerms = await generateJson({
    schema: z.object({ terms: z.array(DomainTermSchema).max(40) }),
    system: SYSTEM,
    prompt: `Pull the terms of art this domain uses.

A term qualifies only if it is jargon: a word or phrase that an outsider would not use,
or would use to mean something else. Exclude ordinary business English
("efficiency", "growth", "platform", "solution", "workflow" on its own).

Every term must be copied verbatim from a source, and evidenceUrl must be the URL of the
source it was copied from, exactly as written in the source header.

${renderSources(state.rawSources, 70_000)}`,
  });

  // Verification, not trust: drop anything the sources do not actually contain.
  const byUrl = new Map(state.rawSources.map((s) => [s.uri, s.text.toLowerCase()]));
  const allText = state.rawSources.map((s) => s.text.toLowerCase()).join("\n");

  const verified: DomainTerm[] = [];
  const seen = new Set<string>();

  for (const term of candidateTerms.terms) {
    const needle = term.term.trim().toLowerCase();
    if (!needle || needle.length < 3) continue;
    if (seen.has(needle)) continue;

    const claimed = byUrl.get(term.evidenceUrl);
    if (claimed?.includes(needle)) {
      seen.add(needle);
      verified.push({ ...term, term: term.term.trim() });
      continue;
    }
    // The term is real but the model cited the wrong page. Repair the citation.
    if (allText.includes(needle)) {
      const actual = state.rawSources.find((s) => s.text.toLowerCase().includes(needle));
      if (actual) {
        seen.add(needle);
        verified.push({ ...term, term: term.term.trim(), evidenceUrl: actual.uri });
      }
    }
    // No evidence anywhere: dropped silently, which is the whole point.
  }

  return { domainLanguage: verified.slice(0, 30) };
}

export async function deriveDisqualifiers(state: ProfileState): Promise<ProfileUpdate> {
  if (!state.icp) return { disqualifiers: [] };

  const result = await generateJson({
    schema: z.object({ disqualifiers: z.array(DisqualifierSchema).min(3).max(8) }),
    system: SYSTEM,
    prompt: `Write the rules that rule a prospect out.

Each rule must be checkable against a company's public footprint, and must be a reason to
stop, not a reason to score lower. Ids are d1, d2, d3...

Good: "Is a direct competitor building the same category of product."
Good: "Is a company under 10 people, which cannot absorb this price point."
Bad: "Is not a great fit." — not checkable.

# Product
${JSON.stringify(state.productDefinition, null, 2)}

# ICP
${JSON.stringify(state.icp, null, 2)}`,
  });

  return { disqualifiers: result.disqualifiers };
}

/**
 * Yes-or-no questions with weights. This is what makes the 60% gate mean
 * something — a free-form score clusters high and lets everything through.
 */
export async function deriveScoringCriteria(state: ProfileState): Promise<ProfileUpdate> {
  if (!state.icp) return { scoringCriteria: [] };

  const result = await generateJson({
    schema: z.object({ criteria: z.array(CriterionSchema).min(6).max(10) }),
    system: SYSTEM,
    prompt: `Write 6 to 10 yes-or-no qualification questions.

Hard requirements:
- Every question must be answerable "yes" or "no" from a candidate's public footprint:
  their website, job posts, news, docs, social presence.
- No question may depend on private information, intent or feelings.
- Weight 1 to 5. Reserve 4 and 5 for the two or three questions that genuinely separate a
  buyer from a bystander. Most questions should be 1 to 3.
- Spread the difficulty. If every question is easy to pass, everything clears the bar and
  the score is worthless.
- Ids are c1, c2, c3...

Example of the right shape: { id: 'c3', question: 'Does the company run paid marketing campaigns?', weight: 2 }

# Product
${JSON.stringify(state.productDefinition, null, 2)}

# ICP
${JSON.stringify(state.icp, null, 2)}

# Domain language
${(state.domainLanguage ?? []).map((t) => `${t.term}: ${t.meaning}`).join("\n")}`,
  });

  return { scoringCriteria: result.criteria };
}

export async function assembleProfile(state: ProfileState): Promise<ProfileUpdate> {
  if (!state.productDefinition || !state.icp) {
    return { errors: ["assemble_profile: refusing to write an incomplete profile"] };
  }

  const profile = await insertProfileVersion(state.productId, {
    productDefinition: state.productDefinition,
    icp: state.icp,
    domainKnowledge:
      state.domainKnowledge ?? {
        marketSummary: "",
        competitors: [],
        commonWorkflows: [],
        painPoints: [],
      },
    domainLanguage: { terms: state.domainLanguage ?? [] },
    disqualifiers: state.disqualifiers ?? [],
    scoringCriteria: state.scoringCriteria ?? [],
    exampleEmails: [],
  });

  await recordBillingEvent({ productId: state.productId, kind: "profile_generated" });

  return { profileId: profile.id };
}
