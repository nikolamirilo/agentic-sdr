"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tails a run's SSE stream and survives a refresh.
 *
 * The last `seq` seen is kept in localStorage per run, so a reload reconnects
 * with `?afterSeq=` and replays only what it missed. Nothing is lost, and the
 * run itself never depended on this connection in the first place.
 */

export type RunEventPayload = Record<string, unknown>;

export type StreamEvent = {
  seq: number;
  kind: string;
  payload: RunEventPayload;
  createdAt?: string;
};

export type LeadCard = {
  id: string;
  fullName: string;
  company?: string | null;
  email?: string | null;
  profileUrl?: string | null;
  signal: string;
  relevance: number;
  contactResolved: boolean;
};

export type NodeLine = {
  node: string;
  label: string;
  detail: string;
  /** Human duration, present on the line a node closes with. */
  took?: string;
  at: number;
};

/**
 * Every cap the loop is running against, as `check_done` reports them at the
 * end of each turn. It records all of them every turn, whether or not one is
 * the cap that fires, which is what makes "why did it stop" answerable — and,
 * while the run is still going, "how close is it to stopping".
 */
export type RunBudgets = {
  leads?: { used: number; cap: number };
  candidates?: { used: number; cap: number };
  seconds?: { used: number; cap: number };
  turns?: { used: number; cap: number };
  tokens?: number;
  modelCalls?: number;
  toolCalls?: number;
};

export type RunStreamState = {
  connected: boolean;
  lines: NodeLine[];
  /**
   * Every line in arrival order, unlike `lines` which keeps one per node.
   * The loop revisits the same nine nodes turn after turn, so the collapsed
   * view cannot show that it has been round three times.
   */
  trail: NodeLine[];
  leads: LeadCard[];
  found: number;
  target: number;
  examined: number;
  /** Which turn of the loop is in flight, 1-based. */
  iteration: number;
  budgets: RunBudgets;
  status: "running" | "done" | "partial" | "failed";
  stopReason?: string;
  error?: string;
  reasoning: Array<{ diagnosis: string; decision: string; queries: string[] }>;
  rejections: Array<{ company?: string; reason: string; relevance?: number }>;
  /**
   * Failures the loop absorbed: a dead URL, a page that would not parse. They
   * are not run-ending by design, but a run that quietly ate thirty of them is
   * a different run from one that ate none.
   */
  warnings: Array<{ node: string; label: string; message: string }>;
};

/** The trail is a live view, not an archive; the tail is the useful part. */
const TRAIL_LIMIT = 60;
const WARNING_LIMIT = 20;

const storageKey = (runId: string) => `sdr.run.${runId}.seq`;

function readSeq(runId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(storageKey(runId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeSeq(runId: string, seq: number): void {
  try {
    window.localStorage.setItem(storageKey(runId), String(seq));
  } catch {
    /* private browsing, or storage disabled: the stream still works */
  }
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" ? value : fallback;

export function useRunStream(runId: string | undefined, initialTarget = 0): RunStreamState & {
  reset: () => void;
} {
  const [state, setState] = useState<RunStreamState>({
    connected: false,
    lines: [],
    trail: [],
    leads: [],
    found: 0,
    target: initialTarget,
    examined: 0,
    iteration: 0,
    budgets: {},
    status: "running",
    reasoning: [],
    rejections: [],
    warnings: [],
  });

  const seenRef = useRef<Set<number>>(new Set());

  const reset = useCallback(() => {
    seenRef.current = new Set();
    setState({
      connected: false,
      lines: [],
      trail: [],
      leads: [],
      found: 0,
      target: initialTarget,
      examined: 0,
      iteration: 0,
      budgets: {},
      status: "running",
      reasoning: [],
      rejections: [],
      warnings: [],
    });
  }, [initialTarget]);

  useEffect(() => {
    if (!runId) return;

    const source = new EventSource(`/api/runs/${runId}/stream?afterSeq=${readSeq(runId)}`);
    let closed = false;

    const apply = (kind: string, raw: MessageEvent) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(raw.data) as StreamEvent;
      } catch {
        return;
      }
      // The server can replay on reconnect; ignore anything already applied.
      if (typeof event.seq === "number") {
        if (seenRef.current.has(event.seq)) return;
        seenRef.current.add(event.seq);
        writeSeq(runId, event.seq);
      }

      const payload = event.payload ?? (event as unknown as RunEventPayload);

      setState((prev) => {
        const next = { ...prev, connected: true };

        switch (kind) {
          // A node closing and a tick from inside one render identically; the
          // closing line simply carries a duration.
          case "node_end":
          case "progress": {
            const line: NodeLine = {
              node: str(payload.node, "step"),
              label: str(payload.label, str(payload.node, "step")),
              detail: str(payload.detail),
              took: str(payload.took) || undefined,
              at: Date.now(),
            };
            // One line per node: the feed shows the latest state of each step,
            // not a transcript of every tick.
            const lines = [...next.lines.filter((l) => l.node !== line.node), line];

            // `node_end` is the machine-readable twin of the `progress` line a
            // node closes with, so counting it here would double every entry.
            const trail =
              kind === "node_end" ? next.trail : [...next.trail, line].slice(-TRAIL_LIMIT);

            return {
              ...next,
              lines,
              trail,
              found: num(payload.found, next.found),
              target: num(payload.target, next.target),
              examined: num(payload.examined, next.examined),
              iteration: num(payload.iteration, next.iteration),
              // Only check_done carries these, once a turn.
              budgets: (payload.budgets as RunBudgets | undefined) ?? next.budgets,
            };
          }
          case "lead": {
            const lead = payload.lead as LeadCard | undefined;
            if (!lead) return next;
            if (next.leads.some((l) => l.id === lead.id)) return next;
            return { ...next, leads: [...next.leads, lead], found: next.leads.length + 1 };
          }
          case "candidate": {
            const verdict = str(payload.verdict);
            if (verdict !== "below_threshold" && verdict !== "disqualified") return next;
            return {
              ...next,
              rejections: [
                {
                  company: str(payload.company) || undefined,
                  reason: str(payload.reason),
                  relevance: typeof payload.relevance === "number" ? payload.relevance : undefined,
                },
                ...next.rejections,
              ].slice(0, 30),
            };
          }
          case "reasoning": {
            return {
              ...next,
              reasoning: [
                {
                  diagnosis: str(payload.diagnosis),
                  decision: str(payload.decision),
                  queries: Array.isArray(payload.queries) ? (payload.queries as string[]) : [],
                },
                ...next.reasoning,
              ],
            };
          }
          case "done": {
            const status = str(payload.status, "done");
            // The terminal event is the authoritative tally: the loop reports
            // its own elapsed time and spend rather than the last turn's.
            const usage = payload.usage as
              | { inputTokens?: number; outputTokens?: number; modelCalls?: number; toolCalls?: number }
              | undefined;
            const elapsed = num(payload.elapsedSeconds, -1);

            return {
              ...next,
              status: status === "partial" ? "partial" : status === "failed" ? "failed" : "done",
              stopReason: str(payload.reason) || next.stopReason,
              found: num(payload.found, next.found),
              target: num(payload.target, next.target),
              examined: num(payload.examined, next.examined),
              iteration: num(payload.iterations, next.iteration),
              budgets: {
                ...next.budgets,
                ...(elapsed >= 0
                  ? { seconds: { used: elapsed, cap: next.budgets.seconds?.cap ?? 0 } }
                  : {}),
                ...(usage
                  ? {
                      tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
                      modelCalls: usage.modelCalls,
                      toolCalls: usage.toolCalls,
                    }
                  : {}),
              },
              connected: false,
            };
          }
          case "error": {
            if (payload.fatal === false) {
              // Absorbed, not fatal — but counted, so it is not invisible.
              const node = str(payload.node, "step");
              return {
                ...next,
                warnings: [
                  ...next.warnings,
                  { node, label: str(payload.label, node), message: str(payload.detail) || str(payload.message) },
                ].slice(-WARNING_LIMIT),
              };
            }
            return { ...next, status: "failed", error: str(payload.message, "the run failed") };
          }
          default:
            return next;
        }
      });
    };

    const kinds = [
      "progress",
      "node_start",
      "node_end",
      "lead",
      "candidate",
      "reasoning",
      "done",
      "error",
      "open",
    ];
    const handlers = kinds.map((kind) => {
      const handler = (raw: MessageEvent) => apply(kind, raw);
      source.addEventListener(kind, handler as EventListener);
      return { kind, handler };
    });

    source.onopen = () => setState((prev) => ({ ...prev, connected: true }));
    source.onerror = () => {
      // EventSource reconnects on its own; only a terminal event stops us.
      if (!closed) setState((prev) => ({ ...prev, connected: false }));
    };

    return () => {
      closed = true;
      for (const { kind, handler } of handlers) {
        source.removeEventListener(kind, handler as EventListener);
      }
      source.close();
    };
  }, [runId]);

  return { ...state, reset };
}
