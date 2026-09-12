import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getPool } from "@/lib/db/client";

/**
 * LangGraph's PostgresSaver creates its own checkpoint tables. Let it.
 * Shares the app's pool so Render does not hold two sets of connections open.
 */

declare global {
   
  var __sdrCheckpointer: { saver: PostgresSaver; ready: Promise<void> } | undefined;
}

export function getCheckpointer(): PostgresSaver {
  if (!globalThis.__sdrCheckpointer) {
    const saver = new PostgresSaver(getPool());
    globalThis.__sdrCheckpointer = { saver, ready: saver.setup() };
  }
  return globalThis.__sdrCheckpointer.saver;
}

/** Await once before the first graph invocation; the setup is idempotent. */
export async function checkpointerReady(): Promise<PostgresSaver> {
  const saver = getCheckpointer();
  await globalThis.__sdrCheckpointer!.ready;
  return saver;
}
