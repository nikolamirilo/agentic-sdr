import { query } from "@/lib/db/client";
import type { RunEvent, RunEventKind } from "@/lib/types";

/**
 * The streaming spine. Graph nodes write rows here; the SSE route tails them.
 * Nothing else couples the loop to the browser, which is why a closed laptop
 * lid does not kill a paid research run.
 */

/**
 * `seq` is computed in SQL so it stays monotonic per run. Parallel nodes can
 * collide on the unique index, so a collision just retries with the next number.
 */
export async function emit(
  runId: string,
  kind: RunEventKind,
  payload: Record<string, unknown> = {}
): Promise<number | undefined> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const rows = await query<{ seq: number }>(
        `insert into run_events (run_id, seq, kind, payload)
         select $1::uuid, coalesce(max(seq), 0) + 1, $2, $3::jsonb
         from run_events where run_id = $1::uuid
         returning seq`,
        [runId, kind, JSON.stringify(payload)]
      );
      return rows[0]?.seq;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") continue; // unique_violation: another node took this seq
      console.error("[runEvents] emit failed", (error as Error).message);
      return undefined;
    }
  }
  return undefined;
}

/**
 * Whether anything has ever been written for this id.
 *
 * Research runs have a `research_runs` row to authorise the stream against.
 * An outreach drafting session has no such row — it is a session, not a run —
 * but it writes the same events, so the existence of its events is what says
 * the id is real.
 */
export async function hasRunEvents(runId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    `select 1 as one from run_events where run_id = $1::uuid limit 1`,
    [runId]
  );
  return rows.length > 0;
}

export async function readEventsSince(runId: string, afterSeq: number, limit = 200): Promise<RunEvent[]> {
  const rows = await query<{
    id: string;
    run_id: string;
    seq: number;
    kind: RunEventKind;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `select id, run_id, seq, kind, payload, created_at
     from run_events
     where run_id = $1 and seq > $2
     order by seq asc
     limit $3`,
    [runId, afterSeq, limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  }));
}

/** A narrow emitter handed to graph nodes so they never see the runId plumbing. */
export type Emitter = (kind: RunEventKind, payload?: Record<string, unknown>) => Promise<void>;

export function emitterFor(runId: string): Emitter {
  return async (kind, payload = {}) => {
    await emit(runId, kind, payload);
  };
}
