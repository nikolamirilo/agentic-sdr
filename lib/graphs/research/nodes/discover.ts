import { describeFilters } from "@/lib/providers/up2data";
import { resolveSkills } from "@/lib/skills/registry";
import { mapWithLimit, DEFAULT_CONCURRENCY } from "@/lib/providers/resilience";
import { narrator } from "@/lib/graphs/shared/narrate";
import { canUseTool, runTool, toolContext } from "@/lib/tools";
import { normalizeDomain } from "@/lib/identity";
import type { RawCandidate } from "@/lib/types";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

const PER_QUERY_LIMIT = 10;

/**
 * One page. LinkedIn search bills per page of 25 whether you read 3 of them or
 * 25, and a second page on the same filters returns people the first page
 * already ranked below the ones we have — so widen the filters, not the page
 * count, when a run is short of candidates.
 */
const LINKEDIN_RESULT_LIMIT = 25;

/**
 * Exa search, plus find-similar when the profile carries an example customer,
 * plus the LinkedIn people search when the ICP produced facets.
 *
 * The two sources answer different questions and the overlap is small: Exa finds
 * companies that have been written about, LinkedIn finds the person holding the
 * job today. Dedupe sorts out the rare candidate found by both.
 */
export async function discover(state: ResearchState): Promise<ResearchUpdate> {
  const log = narrator(state.runId, "research");
  await log.start("discover", `turn ${state.iterations + 1}, ${state.queries.length} queries`, {
    iteration: state.iterations + 1,
    queries: state.queries,
  });

  const skills = resolveSkills(state.skills, "research");
  const tools = toolContext({
    productId: state.productId,
    runId: state.runId,
    allowedTools: skills.allowedTools,
  });
  const errors: string[] = [];
  const candidates: RawCandidate[] = [];
  // Counted per source so the feed can say where the candidates came from.
  // "40 candidates" is not actionable; "34 from Exa, 6 from LinkedIn" is.
  const bySource: Record<string, number> = {};

  // Never search our own domain back at ourselves.
  const ownDomain = normalizeDomain(state.profile?.icp.exampleCustomerUrls?.[0]);

  if (canUseTool(tools, "exoSearch")) {
    const results = await mapWithLimit(state.queries, DEFAULT_CONCURRENCY, (query) =>
      runTool(
        {
          tool: "exoSearch",
          action: "search",
          query,
          limit: PER_QUERY_LIMIT,
          excludeDomains: ownDomain ? [ownDomain] : undefined,
        },
        tools
      )
    );
    // Awaited in order, so every query's line lands before the node's closing
    // one. Fire-and-forget emits race the `seq` counter and read as out of order.
    for (const [index, result] of results.entries()) {
      if (!result.ok) {
        errors.push(`discover: "${state.queries[index]}" failed (${(result.error as Error).message})`);
        await log.fail("discover", result.error, { query: state.queries[index], source: "exa" });
        continue;
      }
      bySource.exa = (bySource.exa ?? 0) + result.value.length;
      await log.progress("discover", `"${state.queries[index]}" returned ${result.value.length}`, {
        query: state.queries[index],
        source: "exa",
        count: result.value.length,
      });
      candidates.push(...result.value);
    }
  }

  // LinkedIn people search. Facets come from plan_queries and stay put across
  // refinements — refine_queries rewrites prose, and a job title is not prose.
  if (state.linkedinFilters && canUseTool(tools, "linkedinSearch")) {
    try {
      const people = await runTool(
        {
          tool: "linkedinSearch",
          action: "people",
          filters: state.linkedinFilters,
          maxResults: LINKEDIN_RESULT_LIMIT,
        },
        tools
      );
      candidates.push(...people);
      bySource.linkedin = people.length;
      await log.progress(
        "discover",
        `LinkedIn returned ${people.length} people matching ${describeFilters(state.linkedinFilters)}`,
        { source: "linkedin", count: people.length }
      );
    } catch (error) {
      // A dead LinkedIn search must not cost us the Exa results already in hand.
      errors.push(`discover: linkedin search failed (${(error as Error).message})`);
      await log.fail("discover", error, { source: "linkedin" });
    }
  }

  // Find-similar only pays off on the first pass; after that the queries have moved on.
  const exampleUrls = state.profile?.icp.exampleCustomerUrls ?? [];
  if (
    state.useProfile &&
    state.iterations === 0 &&
    exampleUrls.length > 0 &&
    canUseTool(tools, "exoSearch")
  ) {
    const similar = await mapWithLimit(exampleUrls.slice(0, 2), 2, (url) =>
      runTool({ tool: "exoSearch", action: "findSimilar", url, limit: PER_QUERY_LIMIT }, tools)
    );
    for (const result of similar) {
      if (!result.ok) continue;
      bySource.findSimilar = (bySource.findSimilar ?? 0) + result.value.length;
      candidates.push(...result.value);
    }
    if (bySource.findSimilar) {
      await log.progress("discover", `${bySource.findSimilar} lookalikes of the example customers`, {
        source: "findSimilar",
        count: bySource.findSimilar,
      });
    }
  }

  // Dedupe by source URL before anything downstream pays for them, and append
  // to whatever is already queued rather than discarding it.
  const bySourceUrl = new Map<string, RawCandidate>();
  for (const candidate of [...state.candidateQueue, ...candidates]) {
    if (!bySourceUrl.has(candidate.sourceUrl)) bySourceUrl.set(candidate.sourceUrl, candidate);
  }
  const queue = [...bySourceUrl.values()];

  const breakdown = Object.entries(bySource)
    .map(([source, count]) => `${count} from ${source}`)
    .join(", ");
  const carried = state.candidateQueue.length;

  await log.end(
    "discover",
    `${queue.length} in the queue` +
      (breakdown ? ` — ${breakdown}` : " — nothing found") +
      (carried > 0 ? `, ${carried} carried over` : "") +
      `, ${candidates.length + carried - queue.length} duplicate URLs dropped`,
    { count: queue.length, bySource, carried, errors: errors.length }
  );

  return { candidateQueue: queue, errors };
}
