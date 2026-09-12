import { readEventsSince } from "@/lib/streaming/runEvents";
import { queryOne } from "@/lib/db/client";

/**
 * SSE over `run_events`, polling one indexed table every 500 ms.
 *
 * Deliberately unsophisticated. At this scale the poll costs nothing and it
 * removes any need for Redis, a queue or pub sub. The client tracks the last
 * `seq` it saw and resumes from there, so a refresh loses nothing.
 */

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 30 * 60 * 1000;

function sseFrame(event: string, data: unknown, id?: number): string {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`, "", "");
  return lines.join("\n");
}

export function runEventStream(runId: string, afterSeq: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastSeq = afterSeq;
      let lastBeat = Date.now();

      const push = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      signal.addEventListener("abort", finish);

      // Tell the client where we are picking up, so it can reconcile.
      push(sseFrame("open", { runId, afterSeq }));

      while (!closed && !signal.aborted) {
        let terminal = false;
        try {
          const events = await readEventsSince(runId, lastSeq);
          for (const event of events) {
            lastSeq = event.seq;
            push(sseFrame(event.kind, event, event.seq));
            if (event.kind === "done" || event.kind === "error") terminal = true;
          }
        } catch (error) {
          push(sseFrame("error", { message: (error as Error).message, fatal: false }));
        }

        if (terminal) break;

        // A run that finished before we attached, or that died without writing
        // a terminal event, still has to close the stream.
        const row = await queryOne<{ status: string }>(
          `select status from research_runs where id = $1`,
          [runId]
        ).catch(() => undefined);
        if (row && row.status !== "running") {
          const tail = await readEventsSince(runId, lastSeq).catch(() => []);
          for (const event of tail) {
            lastSeq = event.seq;
            push(sseFrame(event.kind, event, event.seq));
          }
          push(sseFrame("done", { runId, status: row.status, seq: lastSeq }));
          break;
        }

        if (Date.now() - lastBeat > HEARTBEAT_MS) {
          push(`: heartbeat\n\n`);
          lastBeat = Date.now();
        }
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          push(sseFrame("timeout", { runId, seq: lastSeq }));
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      finish();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Render sits behind a proxy that will otherwise buffer the stream.
      "x-accel-buffering": "no",
    },
  });
}
