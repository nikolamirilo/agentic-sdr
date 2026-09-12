import { z } from "zod";
import { generateJson } from "@/lib/llm";
import { describeFilters, hasFilters } from "@/lib/providers/up2data";
import { resolveSkills } from "@/lib/skills/registry";
import { renderProfile } from "@/lib/graphs/shared/prompts";
import { emit } from "@/lib/streaming/runEvents";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * LinkedIn's facets, not ours. Seniority and size are fixed vocabularies on
 * their side, so they are enums here — a made-up value is a silently empty
 * search. Geography, industry and school facets are omitted on purpose: they
 * take LinkedIn numeric ids and v1 has no typeahead to resolve a name into one,
 * so those cuts are left to the scoring criteria, which can read a location off
 * the profile anyway.
 */
const SENIORITIES = [
  "owner",
  "partner",
  "cxo",
  "vp",
  "director",
  "manager",
  "senior",
  "entry",
  "training",
  "strategic",
] as const;

const COMPANY_SIZES = [
  "self-employed",
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;

const LinkedInFiltersSchema = z.object({
  titles: z
    .array(z.string())
    .max(8)
    .default([])
    .describe("Exact job titles as they appear on LinkedIn, e.g. 'VP Engineering'. Not descriptions."),
  seniorities: z.array(z.enum(SENIORITIES)).max(4).default([]),
  company_sizes: z.array(z.enum(COMPANY_SIZES)).max(4).default([]),
  keywords: z
    .string()
    .optional()
    .describe("Free text matched against the profile, for the domain's own vocabulary. Omit if titles are enough."),
});

const QueriesSchema = z.object({
  reasoning: z.string(),
  queries: z.array(z.string()).min(3).max(5),
  linkedin: LinkedInFiltersSchema.optional().describe(
    "Facets that select the same buyers as the queries, for the LinkedIn people search"
  ),
});

const SYSTEM = `You write web search queries for a sales development agent.

The search engine is neural, not keyword: it rewards natural phrasing and the vocabulary a
real practitioner would use. It punishes boolean operators and stuffed keywords.

A good query names a segment, a situation and a signal. "fintech companies" is useless.
"Series A payments companies hiring their first compliance lead" is usable.

You also fill in LinkedIn search facets, which work nothing like the queries. They are an
AND across a fixed vocabulary, so breadth there is safety: two or three real job titles beat
eight speculative ones, and a title nobody actually holds returns nothing at all. Leave a
facet out rather than guessing at it.`;

/**
 * Build 3 to 5 queries from the ICP plus domain language. Using the real
 * vocabulary is a quiet advantage, since semantic search rewards it.
 */
export async function planQueries(state: ResearchState): Promise<ResearchUpdate> {
  await emit(state.runId, "node_start", { node: "plan_queries" });

  const skills = resolveSkills(state.skills, "research");

  // The control arm searches from the product name alone. This is the whole
  // point of the comparison view: the same loop, without the profile.
  if (!state.useProfile || !state.profile) {
    const name = state.profile?.productDefinition.name ?? "this product";
    const queries = [
      `companies that would buy ${name}`,
      `businesses looking for ${name}`,
      `${name} target customers`,
    ];
    await emit(state.runId, "progress", {
      node: "plan_queries",
      label: "Planning search",
      detail: "no profile (control arm)",
      queries,
    });
    // No facets for the control arm: the filters are an ICP restated, and the
    // control arm is the run that has no ICP.
    return { queries, queriesTried: queries };
  }

  const result = await generateJson({
    schema: QueriesSchema,
    runId: state.runId,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `Write 3 to 5 search queries that will surface people or companies matching this ICP.

Use the domain language verbatim where it fits — it is how this market talks about itself.
Each query must target a different slice of the ICP, not a rewording of the same slice.

Then fill in the LinkedIn facets for the buyer roles in this ICP, so the same people can be
found by title rather than by what has been written about them on the open web.

${renderProfile(state.profile)}`,
  });

  // An all-empty filter object would be a paid search for "everyone".
  const linkedinFilters = hasFilters(result.linkedin) ? result.linkedin : undefined;

  await emit(state.runId, "progress", {
    node: "plan_queries",
    label: "Planning search",
    detail: result.reasoning,
    queries: result.queries,
    linkedin: linkedinFilters ? describeFilters(linkedinFilters) : undefined,
    skills: skills.names,
  });

  return { queries: result.queries, queriesTried: result.queries, linkedinFilters };
}
