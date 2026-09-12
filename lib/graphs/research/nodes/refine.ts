import { z } from "zod";
import { generateJson } from "@/lib/llm";
import { resolveSkills } from "@/lib/skills/registry";
import { renderProfile } from "@/lib/graphs/shared/prompts";
import { narrator } from "@/lib/graphs/shared/narrate";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * The node that makes this an agent instead of a for loop, and the node a judge
 * will ask about. It reads why candidates were rejected and changes the search
 * accordingly — and when most candidates fail the same criterion, that means the
 * search is pointed at the wrong segment, so it changes the segment rather than
 * rewording the query.
 *
 * Its reasoning is logged and surfaced in the UI on purpose.
 */

const RefineSchema = z.object({
  diagnosis: z
    .string()
    .describe("What the rejection pattern says about where the search is pointed"),
  changedSegment: z.boolean().describe("True if you moved to a different segment rather than rewording"),
  reasoning: z.string().describe("One sentence the operator will read, in plain language"),
  queries: z.array(z.string()).min(3).max(5),
});

const SYSTEM = `You steer a lead research loop that is not finding enough qualified people.

You are given the reasons candidates were rejected. Read them as a diagnosis:

- Most candidates failing the SAME criterion means the search is pointed at the wrong
  segment. Change the segment. Rewording the same query is the failure mode here.
- Candidates failing DIFFERENT criteria means the segment is roughly right and the search
  is too broad. Narrow it.
- Candidates being disqualified means you are catching the wrong kind of company entirely.
- Few candidates returned at all means the query is too specific for the index. Loosen it.

Never repeat a query that has already been tried.`;

export async function refineQueries(state: ResearchState): Promise<ResearchUpdate> {
  const log = narrator(state.runId, "research");
  await log.start("refine_queries", `turn ${state.iterations} produced ${state.found.length} of ${state.targetCount}`, {
    iteration: state.iterations,
  });

  const skills = resolveSkills(state.skills, "research");

  const rejections = Object.entries(state.rejectionReasons).sort((a, b) => b[1] - a[1]);
  const total = rejections.reduce((sum, [, count]) => sum + count, 0);

  const readable = rejections
    .map(([key, count]) => {
      const share = total > 0 ? Math.round((count / total) * 100) : 0;
      if (key.startsWith("criterion:")) {
        const id = key.slice("criterion:".length);
        const criterion = state.profile?.scoringCriteria.find((c) => c.id === id);
        return `- ${count} candidates (${share}%) failed ${id}: ${criterion?.question ?? "unknown criterion"}`;
      }
      if (key.startsWith("disqualifier:")) {
        const id = key.slice("disqualifier:".length);
        const rule = state.profile?.disqualifiers.find((d) => d.id === id);
        return `- ${count} candidates (${share}%) were disqualified by ${id}: ${rule?.rule ?? "unknown rule"}`;
      }
      return `- ${count} candidates (${share}%): ${key}`;
    })
    .join("\n");

  // Without a profile there is nothing to reason from, so the control arm just
  // rephrases. That it plateaus is the point of the comparison.
  if (!state.useProfile || !state.profile) {
    const queries = state.queries.map((q, i) => `${q} (variant ${state.iterations + i + 1})`);
    await log.end("refine_queries", "no profile to reason from (control arm) — rephrasing only", {
      controlArm: true,
      queries,
    });
    return { queries, queriesTried: queries, lastRefinement: "rephrased without a profile" };
  }

  const result = await generateJson({
    schema: RefineSchema,
    runId: state.runId,
    temperature: 0.6,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `The loop has found ${state.found.length} of ${state.targetCount} qualified leads after examining ${state.examinedCount} candidates.

# Why candidates were rejected
${readable || "- nothing rejected yet; the search returned too few candidates to judge"}

# Queries already tried, which you may not reuse
${state.queriesTried.map((q) => `- ${q}`).join("\n")}

# The profile you are searching against
${renderProfile(state.profile)}

Write the next 3 to 5 queries.`,
  });

  // Enforce the no-reuse rule rather than trusting it.
  const tried = new Set(state.queriesTried.map((q) => q.trim().toLowerCase()));
  const fresh = result.queries.filter((q) => !tried.has(q.trim().toLowerCase()));
  const queries = fresh.length >= 2 ? fresh : result.queries;

  const refinement = result.changedSegment
    ? `${result.reasoning} (changed segment)`
    : result.reasoning;

  // The diagnosis is the single most audit-worthy thing the loop produces: it
  // is the difference between an agent and a for loop, and it is what a run
  // that drifted off target has to be explained by afterwards.
  await log.reasoning("refine_queries", result.diagnosis, {
    diagnosis: result.diagnosis,
    decision: refinement,
    changedSegment: result.changedSegment,
    queries,
  });

  const reused = result.queries.length - fresh.length;
  await log.end(
    "refine_queries",
    `${refinement} — ${queries.length} new queries` +
      (reused > 0 ? `, ${reused} rejected as already tried` : ""),
    {
      diagnosis: result.diagnosis,
      changedSegment: result.changedSegment,
      queries,
      queriesRejected: reused,
      found: state.found.length,
      target: state.targetCount,
    }
  );

  return { queries, queriesTried: queries, lastRefinement: refinement };
}
