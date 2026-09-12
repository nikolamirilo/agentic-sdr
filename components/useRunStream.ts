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

export type RunStreamState = {
  connected: boolean;
  lines: NodeLine[];
  leads: LeadCard[];
  found: number;
  target: number;
  examined: number;
  status: "running" | "done" | "partial" | "failed";
  stopReason?: string;
  error?: string;
  reasoning: Array<{ diagnosis: string; decision: string; queries: string[] }>;
  rejections: Array<{ company?: string; reason: string; relevance?: number }>;
};

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
    leads: [],
    found: 0,
    target: initialTarget,
    examined: 0,
    status: "running",
    reasoning: [],
    rejections: [],
  });

  const seenRef = useRef<Set<number>>(new Set());

  const reset = useCallback(() => {
    seenRef.current = new Set();
    setState({
      connected: false,
      lines: [],
      leads: [],
      found: 0,
      target: initialTarget,
      examined: 0,
      status: "running",
      reasoning: [],
      rejections: [],
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
            return {
              ...next,
              lines,
              found: num(payload.found, next.found),
              target: num(payload.target, next.target),
              examined: num(payload.examined, next.examined),
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
            return {
              ...next,
              status: status === "partial" ? "partial" : status === "failed" ? "failed" : "done",
              stopReason: str(payload.reason) || next.stopReason,
              found: num(payload.found, next.found),
              connected: false,
            };
          }
          case "error": {
            if (payload.fatal === false) return next;
            return { ...next, status: "failed", error: str(payload.message, "the run failed") };
          }
          default:
            return next;
        }
      });
    };

    const kinds = ["progress", "lead", "candidate", "reasoning", "node_start", "done", "error", "open"];
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
