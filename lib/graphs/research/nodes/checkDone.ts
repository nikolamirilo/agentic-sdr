import { END } from "@langchain/langgraph";
import { emit } from "@/lib/streaming/runEvents";
import { narrator } from "@/lib/graphs/shared/narrate";
import { assertTokenBudget, BudgetExceededError, getRunUsage } from "@/lib/llm";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * The stop condition. Without a hard budget a narrow ICP loops until the
 * credits are gone, so every exit here is deliberate.
 *
 * This node used to be silent, which made it the hardest part of a run to
 * explain: a loop that went round five more times and a loop that gave up
 * looked identical from outside. Now every branch says which of the four caps
 * it is reading and how close the run is to each — so "why is this still
 * going" and "why did it stop at seven leads" are answerable from the feed.
 */
export async function checkDone(state: ResearchState): Promise<ResearchUpdate> {
  const log = narrator(state.runId, "research");
  const elapsedSeconds = (Date.now() - state.startedAt) / 1000;
  const turn = state.iterations + 1;

  await log.start("check_done", `after turn ${turn}`, { iteration: turn });

  // Every cap, every turn, whether or not it is the one that fires. Reading a
  // run afterwards means asking which budget ran out first, and that question
  // is only answerable if all of them were recorded all along.
  const usage = await getRunUsage(state.runId).catch(() => undefined);
  const budgets = {
    leads: { used: state.found.length, cap: state.targetCount },
    candidates: { used: state.examinedCount, cap: state.budget.maxCandidates },
    seconds: { used: Math.round(elapsedSeconds), cap: state.budget.maxSeconds },
    turns: { used: turn, cap: 5 },
    tokens: usage ? usage.inputTokens + usage.outputTokens : undefined,
    modelCalls: usage?.modelCalls,
    toolCalls: usage?.toolCalls,
  };

  const stop = async (outcome: "done" | "partial", reason: string): Promise<ResearchUpdate> => {
    await log.end("check_done", `stopping — ${reason}`, { outcome, reason, budgets });
    return { outcome, stopReason: reason };
  };

  if (state.found.length >= state.targetCount) {
    return stop("done", `found ${state.found.length} of ${state.targetCount}`);
  }

  if (state.examinedCount >= state.budget.maxCandidates) {
    return stop("partial", `examined ${state.examinedCount} candidates, the budget cap`);
  }

  if (elapsedSeconds >= state.budget.maxSeconds) {
    return stop("partial", `ran for ${Math.round(elapsedSeconds)}s, the wall clock cap`);
  }

  try {
    await assertTokenBudget(state.runId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return stop("partial", error.reason);
    }
    throw error;
  }

  // A loop that keeps discovering nothing new is not going to start.
  if (turn >= 5) {
    return stop("partial", "reached the iteration cap without filling the target");
  }

  /**
   * The continuing case, which is the one worth narrating properly: it is the
   * only place that shows the loop closing the gap — or failing to. A run whose
   * "short by" number does not move across three turns is a run whose ICP is
   * wrong, and that is visible here before the budget runs out.
   */
  const short = state.targetCount - state.found.length;
  await log.end(
    "check_done",
    `short by ${short} — going round again (turn ${turn + 1}); ` +
      `${state.examinedCount}/${state.budget.maxCandidates} candidates, ` +
      `${Math.round(elapsedSeconds)}/${state.budget.maxSeconds}s spent`,
    { continuing: true, short, budgets }
  );

  return { outcome: undefined, stopReason: undefined, iterations: 1 };
}

export function routeAfterCheck(state: ResearchState): typeof END | "refine_queries" {
  return state.outcome ? END : "refine_queries";
}

/** Called once the graph settles, so the terminal event carries the real reason. */
export async function emitDone(state: ResearchState): Promise<void> {
  const usage = await getRunUsage(state.runId).catch(() => undefined);
  const elapsedSeconds = Math.round((Date.now() - state.startedAt) / 1000);

  // The closing line of the log, and the one a partial run is judged on. The
  // spec is explicit that a partial result returns a clear message rather than
  // hanging, so the reason and the cost both go on the record.
  console.log(
    `[research ${state.runId.slice(0, 8)}] ■ ${state.outcome ?? "partial"} — ` +
      `${state.found.length}/${state.targetCount} leads, ${state.examinedCount} examined, ` +
      `${state.iterations} turns, ${elapsedSeconds}s, ${usage?.modelCalls ?? 0} model calls, ` +
      `${usage?.toolCalls ?? 0} tool calls — ${state.stopReason ?? "loop ended"}`
  );

  await emit(state.runId, "done", {
    status: state.outcome ?? "partial",
    found: state.found.length,
    target: state.targetCount,
    examined: state.examinedCount,
    iterations: state.iterations,
    elapsedSeconds,
    usage,
    errors: state.errors.length,
    reason: state.stopReason ?? "loop ended",
  });
}
