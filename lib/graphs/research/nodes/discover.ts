import { describeFilters } from "@/lib/providers/up2data";
import { resolveSkills } from "@/lib/skills/registry";
import { mapWithLimit, DEFAULT_CONCURRENCY } from "@/lib/providers/resilience";
import { emit } from "@/lib/streaming/runEvents";
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
  await emit(state.runId, "node_start", { node: "discover" });

  const skills = resolveSkills(state.skills, "research");
  const tools = toolContext({
    productId: state.productId,
    runId: state.runId,
    allowedTools: skills.allowedTools,
  });
  const errors: string[] = [];
  const candidates: RawCandidate[] = [];

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
    results.forEach((result, index) => {
      if (!result.ok) {
        errors.push(`discover: "${state.queries[index]}" failed (${(result.error as Error).message})`);
        return;
      }
      candidates.push(...result.value);
    });
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
      await emit(state.runId, "progress", {
        node: "discover",
        label: "Discovering",
        detail: `LinkedIn: ${people.length} people matching ${describeFilters(state.linkedinFilters)}`,
        source: "linkedin",
        count: people.length,
      });
    } catch (error) {
      // A dead LinkedIn search must not cost us the Exa results already in hand.
      errors.push(`discover: linkedin search failed (${(error as Error).message})`);
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
      if (result.ok) candidates.push(...result.value);
    }
  }

  // Dedupe by source URL before anything downstream pays for them, and append
  // to whatever is already queued rather than discarding it.
  const bySourceUrl = new Map<string, RawCandidate>();
  for (const candidate of [...state.candidateQueue, ...candidates]) {
    if (!bySourceUrl.has(candidate.sourceUrl)) bySourceUrl.set(candidate.sourceUrl, candidate);
  }
  const queue = [...bySourceUrl.values()];

  await emit(state.runId, "progress", {
    node: "discover",
    label: "Discovering",
    detail: `${queue.length} candidates from ${state.queries.length} queries`,
    count: queue.length,
  });

  return { candidateQueue: queue, errors };
}
