"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Icon, Pill } from "@/components/ui";
import { STEPS, stepForPhase } from "@/components/wizard/steps";
import { useIsClient } from "@/components/LocalTime";
import type { RunPhase } from "@/lib/db/queries";

/** What the runs list and the switcher need to draw a run. */
export type RunSummaryView = {
  id: string;
  status: "running" | "done" | "partial" | "failed";
  phase: RunPhase;
  targetCount: number;
  leadCount: number;
  messageCount: number;
  sentCount: number;
  startedAt: string;
  finishedAt: string | null;
};

export function phaseLabel(phase: RunPhase): string {
  const step = STEPS.find((item) => item.id === stepForPhase(phase));
  return step?.label ?? "Research";
}

function when(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local time only after hydration — the server's locale and zone aren't the viewer's. */
function RunTime({ iso }: { iso: string }) {
  const client = useIsClient();
  return <>{client ? when(iso) : "…"}</>;
}

function statusTone(status: RunSummaryView["status"]) {
  if (status === "running") return "accent" as const;
  if (status === "failed") return "bad" as const;
  if (status === "partial") return "warn" as const;
  return "good" as const;
}

/**
 * Switching run is a context change, not a step change: a different run has its
 * own leads, its own drafts and its own phase to resume at. So this navigates
 * for real rather than swapping local state, and the server resolves the target
 * run's phase on the way in — which is the whole point of clicking one.
 */
export function RunSwitcher({
  productId,
  runs,
  currentRunId,
}: {
  productId: string;
  runs: RunSummaryView[];
  currentRunId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = runs.find((run) => run.id === currentRunId) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 max-w-[15rem] items-center gap-2 rounded-[9px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken"
      >
        {current?.status === "running" && (
          <span className="pulse-soft h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {current ? (
            <>
              Run · <RunTime iso={current.startedAt} />
            </>
          ) : runs.length > 0 ? (
            "Select a run"
          ) : (
            "No runs yet"
          )}
        </span>
        <Icon.Chevron
          className={`h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-[12px] border border-line bg-surface shadow-raised"
        >
          {runs.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-3">
              No runs yet. Start one from the Research step.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              {runs.map((run) => (
                <a
                  key={run.id}
                  href={`/admin/products/${productId}?run=${run.id}`}
                  role="menuitem"
                  aria-current={run.id === currentRunId ? "true" : undefined}
                  className={`block px-4 py-2.5 transition-colors hover:bg-surface-sunken ${
                    run.id === currentRunId ? "bg-accent-tint/40" : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] text-ink"><RunTime iso={run.startedAt} /></span>
                    <Pill tone={statusTone(run.status)}>{run.status}</Pill>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                    {run.leadCount} of {run.targetCount} leads · {phaseLabel(run.phase)}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The full list, for the Research phase.
 *
 * The switcher in the header is for moving between runs you know about; this is
 * for seeing that they exist at all — which, until now, nothing in the UI did.
 */
export function RunList({
  productId,
  runs,
  currentRunId,
}: {
  productId: string;
  runs: RunSummaryView[];
  currentRunId: string | null;
}) {
  if (runs.length === 0) return null;

  return (
    <div>
      <p className="section-number mb-3">ALL RUNS · {runs.length}</p>
      <ul className="space-y-2">
        {runs.map((run) => {
          const current = run.id === currentRunId;
          return (
            <li key={run.id}>
              <a
                href={`/admin/products/${productId}?run=${run.id}`}
                className="group block"
                aria-current={current ? "true" : undefined}
              >
                <Card
                  padding="md"
                  className={`transition-colors duration-150 ${
                    current
                      ? "border-accent-line bg-accent-tint/40"
                      : "group-hover:border-accent-line group-hover:bg-accent-tint/20"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {run.status === "running" ? (
                        <span
                          className="pulse-soft h-2 w-2 shrink-0 rounded-full bg-accent"
                          aria-hidden
                        />
                      ) : (
                        <Icon.Check className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-ink">
                          <RunTime iso={run.startedAt} />
                          {current && <span className="ml-2 text-[12px] text-accent">current</span>}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3">
                          Stopped at {phaseLabel(run.phase)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Pill>
                        <span className="tabular font-semibold">{run.leadCount}</span>
                        <span className="opacity-70">/{run.targetCount} leads</span>
                      </Pill>
                      {run.messageCount > 0 && (
                        <Pill>
                          <span className="tabular font-semibold">{run.messageCount}</span>
                          <span className="opacity-70">drafts</span>
                        </Pill>
                      )}
                      {run.sentCount > 0 && (
                        <Pill tone="good">
                          <span className="tabular font-semibold">{run.sentCount}</span>
                          <span className="opacity-70">sent</span>
                        </Pill>
                      )}
                      <Pill tone={statusTone(run.status)}>{run.status}</Pill>
                    </div>
                  </div>
                </Card>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
