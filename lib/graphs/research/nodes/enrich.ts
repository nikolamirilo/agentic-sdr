import { z } from "zod";
import { isLinkedInProfileUrl, renderProfileText } from "@/lib/providers/up2data";
import { resolveSkills } from "@/lib/skills/registry";
import { mapWithLimit, DEFAULT_CONCURRENCY } from "@/lib/providers/resilience";
import { narrator } from "@/lib/graphs/shared/narrate";
import { canUseTool, runTool, toolContext } from "@/lib/tools";
import { computeIdentityKey } from "@/lib/identity";
import { recordCandidate } from "@/lib/db/queries";
import type { EnrichedCandidate, ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * Read the candidate's page, then ask the contact provider for an email.
 * Batched with a concurrency cap of 5.
 *
 * Which reader depends on where the candidate came from. A LinkedIn member page
 * is the one page Firecrawl cannot read — it is behind an auth wall, and a
 * scrape of it returns a login screen, not a person — so those go to Up2Data
 * and everything else goes to Firecrawl. The two never both run on one
 * candidate: that would be paying twice for the same page.
 *
 * A failed read marks the candidate unresolved and the loop continues.
 * One dead URL must never stop a run.
 */

const CandidateExtractSchema = z.object({
  companyName: z.string().optional().describe("The company this page belongs to"),
  personName: z.string().optional().describe("The individual this page is about, if any"),
  role: z.string().optional().describe("Their job title, if stated"),
  whatTheyDo: z.string().optional().describe("What the company does, in one sentence"),
  recentActivity: z
    .array(z.string())
    .default([])
    .describe("Dated, specific things happening: launches, hires, funding, expansions"),
  stackSignals: z
    .array(z.string())
    .default([])
    .describe("Named tools, platforms or protocols this company visibly uses"),
  employeeCountHint: z.string().optional(),
  contactEmails: z.array(z.string()).default([]).describe("Email addresses printed on the page"),
});

/** How many candidates we are willing to pay to examine in one turn of the loop. */
const BATCH_SIZE = 20;

export async function enrich(state: ResearchState): Promise<ResearchUpdate> {
  const log = narrator(state.runId, "research");
  await log.start("enrich");

  const skills = resolveSkills(state.skills, "research");
  const tools = toolContext({
    productId: state.productId,
    runId: state.runId,
    allowedTools: skills.allowedTools,
  });

  // Respect the remaining candidate budget: never examine past the cap.
  const remainingBudget = Math.max(0, state.budget.maxCandidates - state.examinedCount);
  const batch = state.pending.slice(0, Math.min(BATCH_SIZE, remainingBudget));

  if (batch.length === 0) {
    await log.end("enrich", "nothing left to enrich within the candidate budget", {
      remainingBudget,
      pending: state.pending.length,
    });
    return { enriched: [], examinedCount: 0 };
  }

  await log.progress(
    "enrich",
    `reading ${batch.length} pages (${state.pending.length - batch.length} still queued, ` +
      `${remainingBudget} left in the candidate budget)`,
    { inFlight: batch.length, queued: state.pending.length - batch.length, remainingBudget }
  );

  const canScrape = canUseTool(tools, "firecrawlSearch");
  const canLookUpContacts = canUseTool(tools, "contactLookup");
  // One grant covers reading profiles and companies alike.
  const canUseLinkedIn = canUseTool(tools, "linkedinSearch");

  /**
   * Enrichment is the longest node in the loop by a wide margin — a batch of
   * pages read at a concurrency cap, each one a network round trip. Reporting
   * only at the end means minutes of silence, which reads as a hung run. So each
   * candidate reports as it lands, with a running count.
   */
  let done = 0;
  const tick = async (candidate: EnrichedCandidate, detail: string) => {
    done += 1;
    await log.progress("enrich", `[${done}/${batch.length}] ${detail}`, {
      done,
      total: batch.length,
      identityKey: candidate.identityKey,
      company: candidate.company,
    });
  };

  const results = await mapWithLimit(batch, DEFAULT_CONCURRENCY, async (candidate) => {
    let pageText = candidate.snippet ?? "";
    let extracted: z.infer<typeof CandidateExtractSchema> | undefined;
    const evidence: Record<string, unknown> = { ...(candidate.evidence ?? {}) };
    const activity: string[] = [];
    let fullName = candidate.fullName;
    let company = candidate.company;
    let companyDomain = candidate.companyDomain;
    let role = candidate.role;

    const memberUrl = isLinkedInProfileUrl(candidate.sourceUrl) ? candidate.sourceUrl : undefined;

    if (memberUrl && canUseLinkedIn) {
      const profile = await runTool({ tool: "linkedinSearch", action: "profile", url: memberUrl }, tools);
      if (profile) {
        fullName = profile.fullName ?? fullName;
        company = profile.company ?? company;
        role = profile.role ?? role;
        pageText = [renderProfileText(profile), candidate.snippet]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 12_000);
        evidence.linkedInProfile = {
          headline: profile.headline,
          location: profile.location,
          startedAt: profile.startedAt,
          followersCount: profile.followersCount,
          scrapedAt: profile.scrapedAt,
        };
        evidence.companyLinkedInId = profile.companyLinkedInId ?? evidence.companyLinkedInId;
        // Tenure is the fact worth surfacing: someone eight weeks into the job
        // is a different conversation from someone eight years in.
        if (profile.startedAt && profile.role) {
          activity.push(`${profile.role}${profile.company ? ` at ${profile.company}` : ""} since ${profile.startedAt}`);
        }
      }
    } else if (canScrape && !memberUrl) {
      const scraped = await runTool(
        {
          tool: "firecrawlSearch",
          action: "scrape",
          url: candidate.sourceUrl,
          schema: CandidateExtractSchema,
          prompt: "Extract who this company is, what they do, and what is happening there now.",
        },
        tools
      );
      extracted = scraped.json as z.infer<typeof CandidateExtractSchema> | undefined;
      fullName = extracted?.personName ?? fullName;
      company = extracted?.companyName ?? company;
      role = extracted?.role ?? role;
      activity.push(...(extracted?.recentActivity ?? []));
      pageText = [scraped.markdown, candidate.snippet].filter(Boolean).join("\n\n").slice(0, 12_000);
    }

    /**
     * A LinkedIn person arrives with a company name and no website, because the
     * search does not carry one. One company call fixes that: it returns the
     * domain everything downstream keys on — identity, contact lookup, the
     * exclusion list — plus a headcount that is current rather than quarterly.
     * Skipped when we already have a domain, which is every Firecrawl candidate.
     */
    const orgId = typeof evidence.companyLinkedInId === "string" ? evidence.companyLinkedInId : undefined;
    if (canUseLinkedIn && orgId && !companyDomain) {
      const org = await runTool(
        { tool: "linkedinSearch", action: "company", target: { linkedinId: orgId } },
        tools
      );
      if (org) {
        company = org.name ?? company;
        companyDomain = org.domain ?? companyDomain;
        evidence.linkedInCompany = {
          url: org.url,
          website: org.website,
          industry: org.industry,
          headcount: org.headcount,
          headcountGrowth6m: org.headcountGrowth6m,
          hq: org.hq,
          founded: org.founded,
          specialties: org.specialties,
          fundingTotalUsd: org.fundingTotalUsd,
          lastRound: org.lastRound,
        };
        if (org.description) evidence.whatTheyDo = org.description.slice(0, 600);
        if (org.headcount) evidence.employeeCountHint = `${org.headcount} employees on LinkedIn`;
        if (org.headcountGrowth6m && org.headcountGrowth6m > 0) {
          activity.push(`Headcount up ${Math.round(org.headcountGrowth6m * 100)}% in six months`);
        }
        if (org.lastRound?.type) {
          activity.push(
            `${org.lastRound.type}${org.lastRound.date ? ` in ${org.lastRound.date}` : ""}`
          );
        }
      }
    }

    const merged: EnrichedCandidate = {
      ...candidate,
      fullName,
      company,
      companyDomain,
      role,
      pageText,
      evidence: {
        ...evidence,
        whatTheyDo: extracted?.whatTheyDo ?? evidence.whatTheyDo,
        recentActivity: activity,
        stackSignals: extracted?.stackSignals ?? [],
        employeeCountHint: extracted?.employeeCountHint ?? evidence.employeeCountHint,
      },
      contactResolved: Boolean(candidate.email),
    };

    if (!merged.email && canLookUpContacts) {
      const contact = await runTool(
        { tool: "contactLookup", action: "email", candidate: merged, markdown: pageText },
        tools
      ).catch(() => undefined);
      if (contact?.email) {
        merged.email = contact.email;
        merged.phone = contact.phone ?? merged.phone;
        merged.contactResolved = true;
        merged.evidence = { ...merged.evidence, contactProvider: contact.provider };
        // A resolved email is a stronger identity than the URL we started from.
        merged.identityKey =
          computeIdentityKey({ email: contact.email }) ?? merged.identityKey;
      }
    }

    await tick(
      merged,
      `${merged.company ?? merged.fullName ?? merged.sourceUrl}` +
        (memberUrl ? " (LinkedIn)" : "") +
        (merged.contactResolved ? " — contact resolved" : " — no contact")
    );

    return merged;
  });

  const enriched: EnrichedCandidate[] = [];
  const errors: string[] = [];
  let unresolved = 0;

  for (const [index, result] of results.entries()) {
    const candidate = batch[index];
    if (!result.ok) {
      unresolved += 1;
      const message = (result.error as Error).message;
      errors.push(`enrich: ${candidate.sourceUrl} failed (${message})`);
      await log.fail("enrich", result.error, { sourceUrl: candidate.sourceUrl });
      await recordCandidate({
        runId: state.runId,
        productId: state.productId,
        identityKey: candidate.identityKey,
        sourceUrl: candidate.sourceUrl,
        raw: candidate,
        verdict: "unresolved",
        reason: `enrichment failed: ${message}`,
      });
      continue;
    }
    enriched.push(result.value);
  }

  const withContact = enriched.filter((c) => c.contactResolved).length;
  await log.end(
    "enrich",
    `${enriched.length} enriched (${withContact} with a contact), ${unresolved} unreadable`,
    {
      enriched: enriched.length,
      unresolved,
      contactsResolved: withContact,
      examined: state.examinedCount + batch.length,
      budgetCandidates: state.budget.maxCandidates,
    }
  );

  // The candidates we did not take this turn stay queued for the next one.
  return {
    enriched,
    pending: state.pending.slice(batch.length),
    examinedCount: batch.length,
    errors,
  };
}
