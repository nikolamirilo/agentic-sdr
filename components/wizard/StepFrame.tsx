"use client";

import type { ReactNode } from "react";
import { Button, Icon, Spinner } from "@/components/ui";
import { stepMeta, TOTAL_STEPS, type StepId } from "@/components/wizard/steps";

/**
 * Every step is built from this frame: numbered label, big headline, supporting
 * line, content, then Back / Continue. Keeping the frame identical across the
 * five steps is what makes the flow read as one product rather than five
 * screens that happen to be linked.
 */
export function StepFrame({
  step,
  children,
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  continueBusy,
  continueHint,
  secondaryAction,
  hideNav,
  /** Extra bottom padding, so a sticky bar never covers the last control. */
  bottomInset = false,
}: {
  step: StepId;
  children: ReactNode;
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueBusy?: boolean;
  continueHint?: ReactNode;
  secondaryAction?: ReactNode;
  hideNav?: boolean;
  bottomInset?: boolean;
}) {
  const meta = stepMeta(step);

  return (
    <div className="step-in" key={step}>
      <header className="mb-10 max-w-3xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="section-number">{meta.number}</span>
          <span className="h-px w-10 bg-line-strong" aria-hidden />
          <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
            {meta.label}
          </span>
        </div>
        <h1 className="display text-ink">{meta.title}</h1>
        <p className="subhead mt-4 max-w-2xl">{meta.description}</p>
      </header>

      <div className={bottomInset ? "pb-28" : ""}>{children}</div>

      {!hideNav && (
        <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-8">
          <div>
            {onBack ? (
              <Button onClick={onBack} variant="ghost" size="lg">
                <Icon.ArrowLeft />
                Back
              </Button>
            ) : (
              <span className="text-[13px] text-ink-3">
                Step {step} of {TOTAL_STEPS}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {continueHint && <span className="text-[13px] text-ink-3">{continueHint}</span>}
            {secondaryAction}
            {onContinue && (
              <Button
                onClick={onContinue}
                variant="primary"
                size="lg"
                disabled={continueDisabled || continueBusy}
              >
                {continueBusy && <Spinner />}
                {continueLabel}
                {!continueBusy && <Icon.ArrowRight />}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

/** The sticky bar step three uses for its selection count. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-sm [box-shadow:var(--shadow-sticky)]">
      <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-10">
        {children}
      </div>
    </div>
  );
}
