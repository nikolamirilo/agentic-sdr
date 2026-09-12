import { emit } from "@/lib/streaming/runEvents";
import { narrator } from "@/lib/graphs/shared/narrate";
import { recordCandidate } from "@/lib/db/queries";
import { RELEVANCE_THRESHOLD, type ScoredCandidate } from "@/lib/types";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * Drop anything below 0.60 and anything matching a disqualifier. Every drop
 * writes a `candidates` row with the reason and increments rejectionReasons,
 * which is what refine_queries reads to decide what to change.
 */
export async function filter(state: ResearchState): Promise<ResearchUpdate> {
  const log = narrator(state.runId, "research");
  await log.start("filter", `${state.scored.length} scored candidates`, {
    count: state.scored.length,
  });

  const survivors: ScoredCandidate[] = [];
  const rejectionReasons: Record<string, number> = {};
  const bump = (key: string) => {
    rejectionReasons[key] = (rejectionReasons[key] ?? 0) + 1;
  };

  for (const candidate of state.scored) {
    const disqualifiedBy = (candidate.evidence?.disqualifiedBy as string[] | undefined) ?? [];

    if (disqualifiedBy.length > 0) {
      const rule = state.profile?.disqualifiers.find((d) => d.id === disqualifiedBy[0]);
      const reason = rule ? `${rule.id}: ${rule.rule}` : `matched disqualifier ${disqualifiedBy[0]}`;
      bump(`disqualifier:${disqualifiedBy[0]}`);
      await recordCandidate({
        runId: state.runId,
        productId: state.productId,
        identityKey: candidate.identityKey,
        sourceUrl: candidate.sourceUrl,
        raw: candidate,
        score: candidate.relevance,
        verdict: "disqualified",
        reason,
      });
      await emit(state.runId, "candidate", {
        identityKey: candidate.identityKey,
        company: candidate.company,
        verdict: "disqualified",
        reason,
        relevance: candidate.relevance,
      });
      continue;
    }

    // The control arm carries its own gate decision; everything else uses the
    // 60% bar. Both arms are still *scored* against the same criteria.
    const passes = candidate.accepted ?? candidate.relevance >= RELEVANCE_THRESHOLD;

    if (!passes) {
      // Attribute the rejection to the heaviest criterion it failed. That is the
      // one worth changing the search over.
      const failed = candidate.answers
        .filter((a) => !a.met)
        .sort((a, b) => b.weight - a.weight);
      const worst = failed[0];
      if (worst) bump(`criterion:${worst.id}`);
      else bump("criterion:unknown");

      const reason = worst
        ? `scored ${candidate.relevance.toFixed(2)}, failed "${worst.question}"`
        : `scored ${candidate.relevance.toFixed(2)}`;

      await recordCandidate({
        runId: state.runId,
        productId: state.productId,
        identityKey: candidate.identityKey,
        sourceUrl: candidate.sourceUrl,
        raw: candidate,
        score: candidate.relevance,
        verdict: "below_threshold",
        reason,
      });
      await emit(state.runId, "candidate", {
        identityKey: candidate.identityKey,
        company: candidate.company,
        verdict: "below_threshold",
        reason,
        relevance: candidate.relevance,
      });
      continue;
    }

    survivors.push(candidate);
  }

  /**
   * The rejection histogram is the input to refine_queries, so it is logged
   * here rather than only there — when a run ends up somewhere strange, this is
   * the line that explains what the loop was reacting to.
   */
  const topReasons = Object.entries(rejectionReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => `${key} ×${count}`);

  await log.end(
    "filter",
    `${survivors.length} cleared the ${Math.round(RELEVANCE_THRESHOLD * 100)}% bar, ` +
      `${state.scored.length - survivors.length} dropped` +
      (topReasons.length > 0 ? ` — mostly ${topReasons.join(", ")}` : ""),
    {
      survivors: survivors.length,
      rejected: state.scored.length - survivors.length,
      rejectionReasons,
    }
  );

  return { survivors, rejectionReasons, scored: [] };
}
