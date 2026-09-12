import { researchGraph } from "@/lib/graphs/research/graph";
import { emitDone } from "@/lib/graphs/research/nodes/checkDone";
import type { ResearchState } from "@/lib/graphs/research/state";
import { createRun, finishRun, getCurrentProfile, updateRunProgress, type ResearchRun } from "@/lib/db/queries";
import { loadSkills } from "@/lib/skills/registry";
import { emit } from "@/lib/streaming/runEvents";
import { narrator } from "@/lib/graphs/shared/narrate";
import { env } from "@/lib/env";
import { hasModelProvider } from "@/lib/llm";

/**
 * Runs live in this process, on a long lived Node server, and write their
 * progress to Postgres. No job queue, no worker service, and the client can
 * disconnect without killing the run.
 *
 * The tradeoff this accepts: a deploy kills in-flight runs. `failStaleRuns`
 * cleans those up rather than leaving rows stuck on 'running' forever.
 */

type ActiveRun = {
  runId: string;
  productId: string;
  startedAt: number;
  controller: AbortController;
  promise: Promise<void>;
};

declare global {
   
  var __sdrActiveRuns: Map<string, ActiveRun> | undefined;
}

function activeRuns(): Map<string, ActiveRun> {
  if (!globalThis.__sdrActiveRuns) globalThis.__sdrActiveRuns = new Map();
  return globalThis.__sdrActiveRuns;
}

export function isRunActive(runId: string): boolean {
  return activeRuns().has(runId);
}

export function activeRunCount(): number {
  return activeRuns().size;
}

export type StartRunInput = {
  productId: string;
  targetCount: number;
  useProfile?: boolean;
  skillIds?: string[];
  budgetCandidates?: number;
  budgetSeconds?: number;
};

/**
 * Inserts the run row, kicks the graph off with a detached promise and returns.
 * Everything after the insert is deliberately not awaited.
 */
export async function startResearchRun(input: StartRunInput): Promise<ResearchRun> {
  if (!hasModelProvider()) {
    throw new Error(
      "No model provider is configured. Set XAI_API_KEY (or GROK_API_KEY), ANTHROPIC_API_KEY, or OPENAI_API_KEY."
    );
  }

  const useProfile = input.useProfile ?? true;
  const profile = await getCurrentProfile(input.productId);
  if (useProfile && !profile) {
    throw new Error("This product has no profile yet. Generate one before starting research.");
  }

  const budgetCandidates = input.budgetCandidates ?? env.budgetCandidates;
  const budgetSeconds = input.budgetSeconds ?? env.budgetSeconds;
  const skillIds = input.skillIds ?? [];

  // A run pins the exact profile version it used, so it stays reproducible.
  const run = await createRun({
    productId: input.productId,
    profileId: profile?.id ?? null,
    targetCount: input.targetCount,
    budgetCandidates,
    budgetSeconds,
    useProfile,
    skillIds,
  });

  const controller = new AbortController();
  const promise = execute(run, profile, skillIds, useProfile, controller).catch((error) => {
    console.error(`[run ${run.id}] unhandled`, error);
  });

  activeRuns().set(run.id, {
    runId: run.id,
    productId: run.productId,
    startedAt: Date.now(),
    controller,
    promise,
  });

  return run;
}

async function execute(
  run: ResearchRun,
  profile: Awaited<ReturnType<typeof getCurrentProfile>>,
  skillIds: string[],
  useProfile: boolean,
  controller: AbortController
): Promise<void> {
  try {
    const skills = await loadSkills(skillIds);

    const log = narrator(run.id, "research");
    await log.start(
      "start",
      (useProfile
        ? `targeting ${run.targetCount} leads using profile v${profile?.version ?? "?"}`
        : `targeting ${run.targetCount} leads with no profile (control arm)`) +
        ` — budget ${run.budgetCandidates} candidates / ${run.budgetSeconds}s` +
        (skills.length > 0 ? `, skills: ${skills.map((s) => s.name).join(", ")}` : ", no skills"),
      {
        target: run.targetCount,
        useProfile,
        profileVersion: profile?.version,
        skills: skills.map((s) => s.name),
        budget: { candidates: run.budgetCandidates, seconds: run.budgetSeconds },
      }
    );

    const graph = researchGraph();

    const final = (await graph.invoke(
      {
        runId: run.id,
        productId: run.productId,
        profile,
        useProfile,
        targetCount: run.targetCount,
        skills,
        startedAt: Date.now(),
        budget: { maxCandidates: run.budgetCandidates, maxSeconds: run.budgetSeconds },
      },
      {
        // Each loop turn is 9 supersteps; this bounds a runaway graph
        // independently of the budget checks inside check_done.
        recursionLimit: 150,
        signal: controller.signal,
      }
    )) as ResearchState;

    const status = final.outcome ?? (final.found.length >= run.targetCount ? "done" : "partial");

    await updateRunProgress(run.id, {
      foundCount: final.found.length,
      examinedCount: final.examinedCount,
    });
    await finishRun(run.id, status);
    await emitDone(final);
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    console.error(`[research ${run.id.slice(0, 8)}] ■ failed — ${message}`);
    await finishRun(run.id, "failed", message).catch(() => {});
    await emit(run.id, "error", { message, fatal: true }).catch(() => {});
  } finally {
    activeRuns().delete(run.id);
  }
}

/** Stops a run cleanly. Whatever it already found stays found. */
export async function cancelRun(runId: string): Promise<boolean> {
  const active = activeRuns().get(runId);
  if (!active) return false;
  active.controller.abort();
  await finishRun(runId, "partial", "cancelled by the operator").catch(() => {});
  await emit(runId, "done", { status: "partial", reason: "cancelled by the operator" }).catch(() => {});
  activeRuns().delete(runId);
  return true;
}
