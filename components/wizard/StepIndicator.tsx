"use client";

import { STEPS, TOTAL_STEPS, type StepId } from "@/components/wizard/steps";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/ui";
import { ProductSwitcher } from "@/components/wizard/ProductSwitcher";
import { RunSwitcher, type RunSummaryView } from "@/components/wizard/RunSwitcher";
import type { ProductSummary } from "@/components/wizard/Step1Profile";

type Step = (typeof STEPS)[number];

/**
 * Persistent across every step, and the way back to any step already reached.
 * Everything up to `furthest` is navigable in both directions; past it the rail
 * is locked, because jumping to outreach before a run has produced leads is a
 * dead end, not a shortcut.
 *
 * The four run phases are drawn as one bracketed group under the run they
 * belong to, so it reads which part of the rail changes when you switch runs
 * and which part — the profile, the dashboard — belongs to the product.
 */
export function StepIndicator({
  current,
  furthest,
  onNavigate,
  product,
  products,
  runs,
  runId,
}: {
  current: StepId;
  furthest: StepId;
  onNavigate: (step: StepId) => void;
  product: ProductSummary | null;
  products: ProductSummary[];
  runs: RunSummaryView[];
  runId: string | null;
}) {
  const meta = STEPS.find((step) => step.id === current) ?? STEPS[0];

  const before = STEPS.filter((step) => step.scope === "product" && step.id === 1);
  const runSteps = STEPS.filter((step) => step.scope === "run");
  const after = STEPS.filter((step) => step.scope === "product" && step.id !== 1);

  const railStep = (step: Step) => (
    <RailStep
      key={step.id}
      step={step}
      current={current}
      furthest={furthest}
      onNavigate={onNavigate}
    />
  );

  const skillsFrom = product
    ? `/admin/products/${product.id}?step=${current}${runId ? `&run=${runId}` : ""}`
    : undefined;

  return (
    <div className="border-b border-line bg-surface">
      <AdminShell>
        <AppHeader
          skillsFrom={skillsFrom}
          right={
            <>
              <p className="hidden text-[13px] text-ink-2 lg:block">
                <span className="font-medium text-ink">
                  Step {current} of {TOTAL_STEPS}
                </span>
                <span className="mx-1.5 text-ink-3">·</span>
                {meta.label}
              </p>
              {product && (
                <RunSwitcher productId={product.id} runs={runs} currentRunId={runId} />
              )}
              <ProductSwitcher current={product} products={products} />
            </>
          }
        />

        {/* The rail. Collapses to a progress bar on small screens. */}
        <nav aria-label="Progress" className="hidden pb-0 md:block">
          <div className="flex items-end gap-1">
            <ol className="flex min-w-0 flex-[1] items-stretch gap-1">{before.map(railStep)}</ol>

            <div className="min-w-0 flex-[4]">
              <p className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                <span className="h-px w-3 bg-line-strong" aria-hidden />
                {runId ? "This run" : "Run"}
                <span className="h-px flex-1 bg-line-strong" aria-hidden />
              </p>
              <ol className="flex items-stretch gap-1">{runSteps.map(railStep)}</ol>
            </div>

            <ol className="flex min-w-0 flex-[1] items-stretch gap-1">{after.map(railStep)}</ol>
          </div>
        </nav>

        <div className="pb-4 md:hidden">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${(current / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>
      </AdminShell>
    </div>
  );
}

function RailStep({
  step,
  current,
  furthest,
  onNavigate,
}: {
  step: Step;
  current: StepId;
  furthest: StepId;
  onNavigate: (step: StepId) => void;
}) {
  /*
   * Three states, not two. A step behind the one on screen is done, a step past
   * it that has still been reached is open, and anything past `furthest` is
   * locked — so a step you came back from reads as available rather than as
   * unvisited.
   */
  const locked = step.id > furthest;
  const state =
    step.id === current ? "current" : locked ? "locked" : step.id < current ? "done" : "open";

  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => !locked && step.id !== current && onNavigate(step.id)}
        disabled={locked || step.id === current}
        aria-current={state === "current" ? "step" : undefined}
        title={
          locked
            ? `${step.label} opens once the earlier steps have run`
            : step.id === current
              ? undefined
              : `Go to step ${step.id} — ${step.label}`
        }
        className={`group flex w-full flex-col gap-2 pb-3 pt-1 text-left ${
          locked ? "cursor-not-allowed" : state === "current" ? "cursor-default" : "cursor-pointer"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`section-number transition-colors ${locked ? "text-ink-3" : "text-accent"}`}
          >
            {step.number}
          </span>
          <span
            className={`truncate text-[13px] transition-colors ${
              state === "current"
                ? "font-semibold text-ink"
                : state === "locked"
                  ? "text-ink-3"
                  : "font-medium text-ink-2 group-hover:text-ink"
            }`}
          >
            {step.label}
          </span>
          {state === "done" && <Icon.Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
        </span>
        {/*
         * Solid up to the step on screen so the bar still reads as progress;
         * faint for steps reached but ahead of it.
         */}
        <span
          className={`h-[3px] w-full rounded-full transition-colors duration-300 ${
            state === "locked"
              ? "bg-line"
              : state === "open"
                ? "bg-accent/30 group-hover:bg-accent/60"
                : "bg-accent"
          }`}
        />
      </button>
    </li>
  );
}
