"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Icon, Notice, Pill, Spinner } from "@/components/ui";
import type { RunStreamState } from "@/components/useRunStream";

/**
 * The live view of a research run.
 *
 * Lives on the Research phase, which is the one the run belongs to. It used to
 * sit above the lead list, which meant the only way to watch a run was to stand
 * on the step for reviewing its results — and meant reopening a finished run
 * showed its loop transcript again before its leads.
 */

/** The turn the loop repeats, in the order the graph runs it. */
const PIPELINE: Array<{ node: string; short: string }> = [
  { node: "plan_queries", short: "Plan" },
  { node: "discover", short: "Discover" },
  { node: "dedupe", short: "Dedupe" },
  { node: "enrich", short: "Enrich" },
  { node: "score", short: "Score" },
  { node: "filter", short: "Filter" },
  { node: "accumulate", short: "Qualify" },
  { node: "check_done", short: "Check" },
];

type RunRow = {
  startedAt: string;
  finishedAt: string | null;
  targetCount: number;
  budgetSeconds: number;
  budgetCandidates: number;
  foundCount: number;
  examinedCount: number;
  status: string;
};

type RunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  modelCalls?: number;
  toolCalls?: number;
} | null;

function hms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/**
 * What the loop is doing, and how close it is to the caps that will stop it.
 *
 * The stream already carried all of this — `check_done` reports every budget at
 * the end of every turn, each node reports its own duration, and every rejected
 * candidate arrives with the reason it was rejected. None of it was on screen:
 * the run showed one replaced line, so a loop on its third turn looked
 * identical to one that had just started and was burning the same budget.
 */
export function RunMonitor({
  runId,
  stream,
  running,
  targetCount,
  foundCount,
}: {
  runId: string;
  stream: RunStreamState;
  running: boolean;
  targetCount: number;
  foundCount: number;
}) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [usage, setUsage] = useState<RunUsage>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const [showTrail, setShowTrail] = useState(true);
  const [showPassed, setShowPassed] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  /*
   * The caps and the start time come from the run row, so they are on screen
   * during the first turn — `check_done` does not report a budget until it has
   * finished one, and enrichment alone can run for a minute before that.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/runs/${runId}`);
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setRun(data.run as RunRow);
        setUsage((data.usage ?? null) as RunUsage);
      } catch {
        /* the stream is the primary source; this is only the caps */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, stream.status]);

  // The loop reports its elapsed time once a turn. A turn can be minutes, so
  // the clock ticks locally in between rather than sitting still.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  async function stop() {
    setStopping(true);
    setStopError("");
    try {
      const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not stop the run");
      }
    } catch (caught) {
      setStopError((caught as Error).message);
    } finally {
      setStopping(false);
    }
  }

  const current = stream.lines.at(-1);
  const activeIndex = PIPELINE.findIndex((step) => step.node === current?.node);
  const refining = current?.node === "refine_queries";

  const target = stream.target || run?.targetCount || targetCount;
  const found = Math.max(stream.found, foundCount, run?.foundCount ?? 0);

  const examined = Math.max(stream.examined, stream.budgets.candidates?.used ?? 0, run?.examinedCount ?? 0);
  const examinedCap = stream.budgets.candidates?.cap ?? run?.budgetCandidates ?? 0;

  const secondsCap = stream.budgets.seconds?.cap ?? run?.budgetSeconds ?? 0;
  const elapsed = run
    ? ((running ? now : new Date(run.finishedAt ?? run.startedAt).getTime()) -
        new Date(run.startedAt).getTime()) /
      1000
    : (stream.budgets.seconds?.used ?? 0);

  const turn = stream.iteration || stream.budgets.turns?.used || (running ? 1 : 0);
  const turnCap = stream.budgets.turns?.cap ?? 12;

  const modelCalls = stream.budgets.modelCalls ?? usage?.modelCalls;
  const tokens =
    stream.budgets.tokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || undefined);

  return (
    <Card padding="md" className="mb-6">
      {/* ------------------------------------------------- what it is doing */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {running ? (
            <span className="pulse-soft mt-1.5 flex h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
          ) : (
            <Icon.Check className="mt-0.5 h-4 w-4 shrink-0 text-good" />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-medium">
              {running ? current?.label ?? "Starting" : "Research complete"}
              {running && current?.took && (
                <span className="ml-2 font-normal tabular text-ink-3">{current.took}</span>
              )}
            </p>
            {running && current?.detail && (
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{current.detail}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {running && turn > 0 && (
            <Pill>
              <span className="opacity-70">turn</span>
              <span className="tabular font-semibold">
                {turn}
                <span className="font-normal opacity-70">/{turnCap}</span>
              </span>
            </Pill>
          )}
          <Pill tone="accent">
            <span className="tabular font-semibold">{found}</span>
            <span className="font-normal opacity-70">of {target} found</span>
          </Pill>
          {running && (
            <Button size="sm" variant="ghost" onClick={stop} disabled={stopping}>
              {stopping ? <Spinner className="h-3.5 w-3.5" /> : <Icon.Close className="h-3.5 w-3.5" />}
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- how far in */}
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.min(100, (found / Math.max(1, target)) * 100)}%` }}
        />
      </div>

      {/* --------------------------------------------- where in the turn */}
      {running && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {PIPELINE.map((step, index) => {
            const active = index === activeIndex;
            const passed = activeIndex > index || refining;
            return (
              <span
                key={step.node}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium leading-none transition-colors ${
                  active
                    ? "border-accent-line bg-accent-tint text-ink"
                    : passed
                      ? "border-transparent bg-surface-sunken text-ink-2"
                      : "border-transparent bg-surface-sunken text-ink-3 opacity-60"
                }`}
              >
                {active ? (
                  <Spinner className="h-3 w-3 text-accent" />
                ) : passed ? (
                  <Icon.Check className="h-3 w-3 text-accent" />
                ) : null}
                {step.short}
              </span>
            );
          })}
          {refining && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-tint px-2.5 py-1 text-[12px] font-medium leading-none">
              <Spinner className="h-3 w-3 text-accent" />
              Refine
            </span>
          )}
        </div>
      )}

      {/* ------------------------------------------- what it is spending */}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px]">
        <div className="flex items-baseline gap-2">
          <dt className="text-ink-3">Examined</dt>
          <dd className="tabular font-medium">
            {examined}
            {examinedCap > 0 && <span className="font-normal text-ink-3">/{examinedCap}</span>}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-ink-3">Elapsed</dt>
          <dd className="tabular font-medium">
            {hms(elapsed)}
            {secondsCap > 0 && <span className="font-normal text-ink-3">/{hms(secondsCap)}</span>}
          </dd>
        </div>
        {modelCalls !== undefined && (
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-3">Model calls</dt>
            <dd className="tabular font-medium">{modelCalls}</dd>
          </div>
        )}
        {tokens !== undefined && tokens > 0 && (
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-3">Tokens</dt>
            <dd className="tabular font-medium">{compact(tokens)}</dd>
          </div>
        )}
      </dl>

      {stream.stopReason && !running && (
        <p className="mt-3 text-[13px] text-ink-3">Stopped: {stream.stopReason}</p>
      )}
      {stopError && (
        <div className="mt-3">
          <Notice tone="warn">{stopError}</Notice>
        </div>
      )}
      {stream.error && (
        <div className="mt-3">
          <Notice tone="bad">{stream.error}</Notice>
        </div>
      )}

      {/* The reasoning behind a search change is the interesting part, so it shows. */}
      {stream.reasoning.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="section-number mb-2">
            SEARCH REFINED{stream.reasoning.length > 1 && ` · ${stream.reasoning.length}×`}
          </p>
          <p className="text-[14px] leading-relaxed text-ink">{stream.reasoning[0].decision}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            {stream.reasoning[0].diagnosis}
          </p>
          {stream.reasoning[0].queries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stream.reasoning[0].queries.slice(0, 6).map((query) => (
                <span
                  key={query}
                  className="rounded-[6px] bg-surface-sunken px-2 py-1 text-[12px] text-ink-2"
                >
                  {query}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ the transcript */}
      {stream.trail.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Disclosure
            open={showTrail}
            onToggle={() => setShowTrail((prev) => !prev)}
            label={running ? "Activity" : `Activity · ${stream.trail.length} steps`}
          />
          {showTrail && (
            <ol className="mt-2 max-h-64 overflow-y-auto">
              {[...stream.trail]
                .reverse()
                .slice(0, 24)
                .map((line, index) => (
                  <li
                    key={`${line.node}-${line.at}-${index}`}
                    className="flex items-baseline gap-3 border-b border-line py-1.5 text-[13px] last:border-0"
                  >
                    <span className="w-28 shrink-0 truncate font-medium text-ink-2">{line.label}</span>
                    <span className="min-w-0 flex-1 leading-relaxed text-ink-3">{line.detail}</span>
                    {line.took && <span className="shrink-0 tabular text-ink-3">{line.took}</span>}
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}

      {/* ------------------------------------------------ what it turned down */}
      {stream.rejections.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Disclosure
            open={showPassed}
            onToggle={() => setShowPassed((prev) => !prev)}
            label={`Examined and passed on · ${stream.rejections.length}`}
          />
          {showPassed && (
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {stream.rejections.map((rejection, index) => (
                <li
                  key={`${rejection.company ?? "candidate"}-${index}`}
                  className="flex items-baseline gap-3 border-b border-line py-1.5 text-[13px] last:border-0"
                >
                  <span className="w-32 shrink-0 truncate font-medium text-ink-2">
                    {rejection.company ?? "unnamed"}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed text-ink-3">{rejection.reason}</span>
                  {rejection.relevance !== undefined && (
                    <span className="shrink-0 tabular text-ink-3">
                      {Math.round(rejection.relevance * 100)}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/*
        * Absorbed failures. The loop is built so one dead URL or one page that
        * will not parse never ends a run, which also means they leave no trace
        * unless something counts them.
        */}
      {stream.warnings.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Disclosure
            open={showWarnings}
            onToggle={() => setShowWarnings((prev) => !prev)}
            label={`${stream.warnings.length} skipped · dead links, pages that would not parse`}
            icon={<Icon.Warning className="h-3.5 w-3.5 text-warn" />}
          />
          {showWarnings && (
            <ul className="mt-2 max-h-48 overflow-y-auto">
              {stream.warnings.map((warning, index) => (
                <li
                  key={`${warning.node}-${index}`}
                  className="flex items-baseline gap-3 border-b border-line py-1.5 text-[13px] last:border-0"
                >
                  <span className="w-28 shrink-0 truncate font-medium text-ink-2">{warning.label}</span>
                  <span className="min-w-0 flex-1 leading-relaxed text-ink-3">{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Disclosure({
  open,
  onToggle,
  label,
  icon,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
    >
      <Icon.Chevron className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      {icon}
      {label}
    </button>
  );
}
