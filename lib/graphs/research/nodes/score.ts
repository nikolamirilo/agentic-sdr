import { z } from "zod";
import { generateJson } from "@/lib/llm";
import { resolveSkills } from "@/lib/skills/registry";
import { renderCriteria, renderProfile } from "@/lib/graphs/shared/prompts";
import { mapWithLimit, DEFAULT_CONCURRENCY } from "@/lib/providers/resilience";
import { emit } from "@/lib/streaming/runEvents";
import { recordCandidate } from "@/lib/db/queries";
import { RELEVANCE_THRESHOLD, type CriterionAnswer, type ScoredCandidate } from "@/lib/types";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * One model call per candidate, answering the profile's yes-or-no criteria
 * against the gathered evidence.
 *
 *   relevance = sum(weights of criteria met) / sum(all weights)
 *
 * No free-form scoring anywhere. A model asked for "a relevance score out of
 * ten" returns eight every time, and then everything clears the bar.
 */

const AnswerSchema = z.object({
  id: z.string(),
  met: z.boolean(),
  evidence: z.string().describe("The specific fact from the evidence that decides this, or why nothing does"),
});

const ScoreSchema = z.object({
  answers: z.array(AnswerSchema),
  signal: z.string().describe("The one observable thing that makes this candidate interesting right now"),
  disqualifiedBy: z
    .array(z.string())
    .default([])
    .describe("Ids of any disqualifier rules this candidate matches"),
});

const SYSTEM = `You answer qualification questions about a prospect from evidence, one at a time.

Rules:
- Answer only from the evidence supplied. No outside knowledge about the company.
- "Not stated" is a no. Absence of evidence is never a yes.
- Cite the specific fact behind each answer. "Seems likely" is not a fact.
- You are being used to decide whether to spend money contacting this person. A false yes
  costs more than a false no.`;

function evidenceFor(candidate: ScoredCandidate & { pageText?: string }): string {
  const parts = [
    `Source URL: ${candidate.sourceUrl}`,
    candidate.company ? `Company: ${candidate.company}` : undefined,
    candidate.fullName ? `Person: ${candidate.fullName}` : undefined,
    candidate.role ? `Role: ${candidate.role}` : undefined,
    candidate.evidence?.whatTheyDo ? `What they do: ${candidate.evidence.whatTheyDo}` : undefined,
    Array.isArray(candidate.evidence?.recentActivity) && candidate.evidence.recentActivity.length > 0
      ? `Recent activity:\n${(candidate.evidence.recentActivity as string[]).map((a) => `- ${a}`).join("\n")}`
      : undefined,
    Array.isArray(candidate.evidence?.stackSignals) && candidate.evidence.stackSignals.length > 0
      ? `Stack signals: ${(candidate.evidence.stackSignals as string[]).join(", ")}`
      : undefined,
    candidate.evidence?.employeeCountHint ? `Size hint: ${candidate.evidence.employeeCountHint}` : undefined,
    candidate.pageText ? `\nPage content:\n${candidate.pageText.slice(0, 8000)}` : undefined,
  ];
  return parts.filter(Boolean).join("\n");
}

export async function score(state: ResearchState): Promise<ResearchUpdate> {
  await emit(state.runId, "node_start", { node: "score" });
  if (state.enriched.length === 0) return { scored: [] };

  const profile = state.profile;
  const skills = resolveSkills(state.skills, "research");

  /**
   * Two different things, deliberately kept apart:
   *
   * - the GATE is what this arm uses to decide. With a profile it is the
   *   weighted criteria; without one it is a single free-form judgement call,
   *   which is exactly what a system with no profile has to fall back on.
   * - the MEASURE is always the profile's criteria, when a profile exists.
   *
   * Scoring the control arm on its own scale would make it look perfect, because
   * "is this plausible?" is a question a model almost always answers yes to. The
   * comparison only means something if both arms are measured the same way.
   */
  const gateOnCriteria = state.useProfile && Boolean(profile);
  const criteria = gateOnCriteria ? profile!.scoringCriteria : [];
  const measureCriteria = profile?.scoringCriteria ?? [];
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const measureWeight = measureCriteria.reduce((sum, c) => sum + c.weight, 0);

  const results = await mapWithLimit(state.enriched, DEFAULT_CONCURRENCY, async (candidate) => {
    const enrichedForPrompt = candidate as unknown as ScoredCandidate & { pageText?: string };

    if (!gateOnCriteria) {
      // The gate: all a system without a profile can ask.
      const fallback = await generateJson({
        schema: z.object({
          relevant: z.boolean(),
          signal: z.string(),
          why: z.string(),
        }),
        runId: state.runId,
        system: SYSTEM,
        prompt: `Is this a plausible prospect for ${profile?.productDefinition.name ?? "the product"}?

${evidenceFor(enrichedForPrompt)}`,
      });

      let answers: CriterionAnswer[] = [
        {
          id: "unstructured",
          question: "Is this a plausible prospect?",
          weight: 1,
          met: fallback.relevant,
          evidence: fallback.why,
        },
      ];
      let relevance = fallback.relevant ? 1 : 0;

      // The measure: only worth paying for on candidates this arm accepted.
      if (fallback.relevant && measureCriteria.length > 0 && measureWeight > 0) {
        const measured = await answerCriteria(
          state,
          profile!,
          skills.instructions,
          enrichedForPrompt,
          measureCriteria
        );
        answers = measured.answers;
        relevance = measured.relevance;
      }

      return {
        candidate,
        answers,
        relevance,
        signal: fallback.signal,
        disqualifiedBy: [],
        accepted: fallback.relevant,
      };
    }

    const scoredResult = await answerCriteria(
      state,
      profile!,
      skills.instructions,
      enrichedForPrompt,
      criteria,
      totalWeight
    );

    return {
      candidate,
      answers: scoredResult.answers,
      relevance: scoredResult.relevance,
      signal: scoredResult.signal,
      disqualifiedBy: scoredResult.disqualifiedBy,
      accepted: undefined,
    };
  });

  const scored: ScoredCandidate[] = [];
  const errors: string[] = [];

  for (const [index, result] of results.entries()) {
    const candidate = state.enriched[index];
    if (!result.ok) {
      errors.push(`score: ${candidate.sourceUrl} failed (${(result.error as Error).message})`);
      await recordCandidate({
        runId: state.runId,
        productId: state.productId,
        identityKey: candidate.identityKey,
        sourceUrl: candidate.sourceUrl,
        raw: { error: (result.error as Error).message },
        verdict: "unresolved",
        reason: "scoring failed",
      });
      continue;
    }
    const { answers, relevance, signal, disqualifiedBy, accepted } = result.value;
    scored.push({
      ...candidate,
      relevance: Number(relevance.toFixed(3)),
      answers,
      signal: signal || "no signal identified",
      accepted,
      evidence: { ...(candidate.evidence ?? {}), disqualifiedBy },
    });
  }

  const qualified = scored.filter(
    (c) => c.accepted ?? c.relevance >= RELEVANCE_THRESHOLD
  ).length;

  await emit(state.runId, "progress", {
    node: "score",
    label: "Scoring",
    detail: `${qualified} above the bar, ${scored.length - qualified} below`,
    scored: scored.length,
    qualified,
    threshold: RELEVANCE_THRESHOLD,
    distribution: scored.map((c) => c.relevance),
  });

  return { scored, errors };
}

/**
 * Answers the profile's criteria against one candidate's evidence and turns the
 * answers into a weighted fraction. Shared by both arms so the number means the
 * same thing in each.
 */
async function answerCriteria(
  state: ResearchState,
  profile: NonNullable<ResearchState["profile"]>,
  skillInstructions: string,
  candidate: ScoredCandidate & { pageText?: string },
  criteria: typeof profile.scoringCriteria,
  totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0)
): Promise<{
  answers: CriterionAnswer[];
  relevance: number;
  signal: string;
  disqualifiedBy: string[];
}> {
  const result = await generateJson({
    schema: ScoreSchema,
    runId: state.runId,
    system: skillInstructions ? `${SYSTEM}\n\n# Active skills\n${skillInstructions}` : SYSTEM,
    prompt: `Answer every question below about this candidate, then name the signal.

# Questions
${renderCriteria(profile)}

# Disqualifier rules
${profile.disqualifiers.map((d) => `- [${d.id}] ${d.rule}`).join("\n") || "- (none)"}

# What we know about the product and who it is for
${renderProfile(profile)}

# Evidence about this candidate
${evidenceFor(candidate)}`,
  });

  const byId = new Map(result.answers.map((a) => [a.id, a]));
  const answers: CriterionAnswer[] = criteria.map((criterion) => {
    const answer = byId.get(criterion.id);
    return {
      id: criterion.id,
      question: criterion.question,
      weight: criterion.weight,
      // A question the model skipped is a no, not a free pass.
      met: answer?.met ?? false,
      evidence: answer?.evidence ?? "not answered",
    };
  });

  const earned = answers.filter((a) => a.met).reduce((sum, a) => sum + a.weight, 0);

  return {
    answers,
    relevance: totalWeight > 0 ? earned / totalWeight : 0,
    signal: result.signal,
    disqualifiedBy: result.disqualifiedBy,
  };
}
