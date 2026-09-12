"use client";

import { STEPS, TOTAL_STEPS, type StepId } from "@/components/wizard/steps";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/ui";
import { ProductSwitcher } from "@/components/wizard/ProductSwitcher";
import type { ProductSummary } from "@/components/wizard/Step1Profile";

/**
 * Persistent across all five steps, and the way back to any step already
 * reached. Everything up to `furthest` is navigable in both directions; past it
 * the rail is locked, because jumping to outreach before a run has produced
 * leads is a dead end, not a shortcut.
 */
export function StepIndicator({
  current,
  furthest,
  onNavigate,
  product,
  products,
}: {
  current: StepId;
  furthest: StepId;
  onNavigate: (step: StepId) => void;
  product: ProductSummary | null;
  products: ProductSummary[];
}) {
  const meta = STEPS.find((step) => step.id === current) ?? STEPS[0];

  return (
    <div className="border-b border-line bg-surface">
      <AdminShell>
        <AppHeader
          skillsFrom={
            product ? `/admin/products/${product.id}?step=${current}` : undefined
          }
          right={
            <>
              <p className="hidden text-[13px] text-ink-2 sm:block">
                <span className="font-medium text-ink">
                  Step {current} of {TOTAL_STEPS}
                </span>
                <span className="mx-1.5 text-ink-3">·</span>
                {meta.label}
              </p>
              <ProductSwitcher current={product} products={products} />
            </>
          }
        />

        {/* The rail. Collapses to a progress bar on small screens. */}
        <nav aria-label="Progress" className="hidden pb-0 md:block">
          <ol className="flex items-stretch gap-1">
            {STEPS.map((step) => {
              /*
               * Three states, not two. A step behind the one on screen is done,
               * a step past it that has still been reached is open, and
               * anything past `furthest` is locked — so a step you came back
               * from reads as available rather than as unvisited.
               */
              const locked = step.id > furthest;
              const state =
                step.id === current
                  ? "current"
                  : locked
                    ? "locked"
                    : step.id < current
                      ? "done"
                      : "open";

              return (
                <li key={step.id} className="min-w-0 flex-1">
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
                      locked
                        ? "cursor-not-allowed"
                        : state === "current"
                          ? "cursor-default"
                          : "cursor-pointer"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`section-number transition-colors ${
                          locked ? "text-ink-3" : "text-accent"
                        }`}
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
                      {state === "done" && (
                        <Icon.Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                      )}
                    </span>
                    {/*
                     * Solid up to the step on screen so the bar still reads as
                     * progress; faint for steps reached but ahead of it.
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
            })}
          </ol>
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
