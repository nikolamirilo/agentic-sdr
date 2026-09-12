"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lead } from "@/lib/types";
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Icon,
  Notice,
  Pill,
  RelevanceBadge,
  Spinner,
} from "@/components/ui";
import { StepFrame, StickyBar } from "@/components/wizard/StepFrame";
import { useRunStream, type RunStreamState } from "@/components/useRunStream";

/**
 * Results arrive while the loop is still running, so this step is a live view
 * first and a review surface second. The run itself is independent of this
 * page — closing the tab does not stop it, and reopening resumes the stream
 * from the last event seen.
 */
export function Step3Leads({
  runId,
  targetCount,
  leads,
  onLeadsChange,
  selected,
  onSelectedChange,
  onBack,
  onContinue,
}: {
  runId: string | undefined;
  targetCount: number;
  leads: Lead[];
  /**
   * The leads this step fetches are what step four drafts against, so they are
   * owned by the wizard rather than by this component. Keeping them local here
   * is what left step four with nothing to write to.
   */
  onLeadsChange: (leads: Lead[]) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const stream = useRunStream(runId, targetCount);
  const [loading, setLoading] = useState(false);

  const running = Boolean(runId) && stream.status === "running";

  /*
   * The stream carries a trimmed lead card; the full record (criteria, evidence,
   * phone) comes from the API. Refetch when the count changes or the run ends,
   * rather than on every event.
   */
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/runs/${runId}/leads`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) onLeadsChange(data.leads as Lead[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // onLeadsChange is a setState, stable for the life of the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, stream.leads.length, stream.status]);

  const sorted = useMemo(
    () => [...leads].sort((a, b) => b.relevance - a.relevance),
    [leads]
  );

  const allSelected = sorted.length > 0 && selected.length === sorted.length;

  function toggle(id: string) {
    onSelectedChange(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    );
  }

  return (
    <StepFrame
      step={3}
      onBack={onBack}
      hideNav
      bottomInset={sorted.length > 0}
    >
      {runId && (
        <RunMonitor
          runId={runId}
          stream={stream}
          running={running}
          targetCount={targetCount}
          foundCount={sorted.length}
        />
      )}

      {/* ---------------------------------------------------------- leads */}
      {sorted.length === 0 ? (
        running ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Card key={index} padding="md">
                <div className="space-y-3">
                  <div className="shimmer h-5 w-48 rounded-[6px]" />
                  <div className="shimmer h-4 w-full rounded-[6px]" />
                  <div className="shimmer h-4 w-2/3 rounded-[6px]" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty title="No qualified leads yet">
            Nothing cleared the 60% bar. Go back and widen the ICP, lower a criterion weight, or
            raise the candidate budget so the loop has more to work with.
          </Empty>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-ink-2">
              <span className="tabular font-semibold text-ink">{sorted.length}</span> qualified
              {loading && <Spinner className="ml-2 inline h-3.5 w-3.5 text-ink-3" />}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSelectedChange(allSelected ? [] : sorted.map((lead) => lead.id))}
            >
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
          </div>

          <ul className="space-y-3">
            {sorted.map((lead) => (
              <li key={lead.id} className="row-in">
                <LeadCard
                  lead={lead}
                  checked={selected.includes(lead.id)}
                  onToggle={() => toggle(lead.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --------------------------------------------------- sticky action */}
      {sorted.length > 0 && (
        <StickyBar>
          <p className="text-[14px]">
            <span className="tabular font-semibold">{selected.length}</span>
            <span className="text-ink-2"> lead{selected.length === 1 ? "" : "s"} selected</span>
            {selected.length === 0 && (
              <span className="ml-2 text-[13px] text-ink-3">Select at least one to write to</span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={onBack} variant="ghost" size="lg">
              <Icon.ArrowLeft />
              Back
            </Button>
            <Button
              onClick={onContinue}
              variant="primary"
              size="lg"
              disabled={selected.length === 0}
            >
              Draft {selected.length > 0 ? selected.length : ""} message
              {selected.length === 1 ? "" : "s"}
              <Icon.ArrowRight />
            </Button>
          </div>
        </StickyBar>
      )}
    </StepFrame>
  );
}

/* ------------------------------------------------------------ run monitor */

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
function RunMonitor({
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
  const found = Math.max(stream.found, foundCount);

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

function LeadCard({
  lead,
  checked,
  onToggle,
}: {
  lead: Lead;
  checked: boolean;
  onToggle: () => void;
}) {
  const [showCriteria, setShowCriteria] = useState(false);
  const met = lead.criteriaMet.filter((answer) => answer.met).length;

  return (
    <Card
      padding="none"
      className={`transition-colors duration-150 ${checked ? "border-accent-line bg-accent-tint/40" : ""}`}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="pt-0.5">
          <Checkbox checked={checked} onChange={onToggle} label={`Approve ${lead.fullName}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-tight text-ink">{lead.fullName}</h3>
              {lead.company && <p className="mt-0.5 text-[14px] text-ink-2">{lead.company}</p>}
            </div>
            <RelevanceBadge value={lead.relevance} />
          </div>

          {/* The one line that says why this person is here at all. */}
          <p className="mt-3 flex gap-2 text-[14px] leading-relaxed text-ink">
            <span className="section-number mt-[3px] shrink-0">SIGNAL</span>
            <span className="min-w-0">{lead.signal}</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-accent"
              >
                <Icon.Mail className="h-3.5 w-3.5" />
                {lead.email}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <Icon.Mail className="h-3.5 w-3.5" />
                No email resolved
              </span>
            )}

            {lead.phone && (
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Icon.Phone className="h-3.5 w-3.5" />
                {lead.phone}
              </span>
            )}

            {lead.profileUrl && (
              <a
                href={lead.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-accent"
              >
                <Icon.External className="h-3.5 w-3.5" />
                Profile
              </a>
            )}

            <button
              type="button"
              onClick={() => setShowCriteria((prev) => !prev)}
              aria-expanded={showCriteria}
              className="inline-flex items-center gap-1.5 text-ink-3 transition-colors hover:text-ink"
            >
              <Icon.Chevron className={`h-3.5 w-3.5 transition-transform ${showCriteria ? "rotate-180" : ""}`} />
              {met} of {lead.criteriaMet.length} criteria met
            </button>
          </div>

          {showCriteria && (
            <ul className="mt-4 space-y-2 border-t border-line pt-4">
              {lead.criteriaMet.map((answer) => (
                <li key={answer.id} className="flex gap-2.5 text-[13px]">
                  <span className={`mt-0.5 shrink-0 ${answer.met ? "text-good" : "text-ink-3"}`}>
                    {answer.met ? <Icon.Check className="h-3.5 w-3.5" /> : <Icon.Close className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={answer.met ? "text-ink" : "text-ink-3"}>{answer.question}</span>
                    <span className="section-number ml-2">W{answer.weight}</span>
                    <span className="mt-0.5 block leading-relaxed text-ink-3">{answer.evidence}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
