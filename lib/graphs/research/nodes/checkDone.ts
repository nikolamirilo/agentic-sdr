import { END } from "@langchain/langgraph";
import { emit } from "@/lib/streaming/runEvents";
import { assertTokenBudget, BudgetExceededError } from "@/lib/llm";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * The stop condition. Without a hard budget a narrow ICP loops until the
 * credits are gone, so every exit here is deliberate.
 */
export async function checkDone(state: ResearchState): Promise<ResearchUpdate> {
  const elapsedSeconds = (Date.now() - state.startedAt) / 1000;

  if (state.found.length >= state.targetCount) {
    return { outcome: "done", stopReason: `found ${state.found.length} of ${state.targetCount}` };
  }

  if (state.examinedCount >= state.budget.maxCandidates) {
    return {
      outcome: "partial",
      stopReason: `examined ${state.examinedCount} candidates, the budget cap`,
    };
  }

  if (elapsedSeconds >= state.budget.maxSeconds) {
    return {
      outcome: "partial",
      stopReason: `ran for ${Math.round(elapsedSeconds)}s, the wall clock cap`,
    };
  }

  try {
    await assertTokenBudget(state.runId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { outcome: "partial", stopReason: error.reason };
    }
    throw error;
  }

  // A loop that keeps discovering nothing new is not going to start.
  if (state.iterations >= 12) {
    return { outcome: "partial", stopReason: "reached the iteration cap without filling the target" };
  }

  return { outcome: undefined, stopReason: undefined, iterations: 1 };
}

export function routeAfterCheck(state: ResearchState): typeof END | "refine_queries" {
  return state.outcome ? END : "refine_queries";
}

/** Called once the graph settles, so the terminal event carries the real reason. */
export async function emitDone(state: ResearchState): Promise<void> {
  await emit(state.runId, "done", {
    status: state.outcome ?? "partial",
    found: state.found.length,
    target: state.targetCount,
    examined: state.examinedCount,
    reason: state.stopReason ?? "loop ended",
  });
}
