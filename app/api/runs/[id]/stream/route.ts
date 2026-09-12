import { getRun } from "@/lib/db/queries";
import { runEventStream } from "@/lib/streaming/sse";
import { apiError } from "@/lib/api";

/**
 * SSE over `run_events`. The client sends the last `seq` it saw, so a refresh
 * or a reconnect resumes exactly where it left off and nothing is lost.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/stream">) {
  const { id } = await ctx.params;

  const run = await getRun(id);
  if (!run) return apiError("Run not found", 404);

  const url = new URL(request.url);
  const afterSeq =
    Number(url.searchParams.get("afterSeq") ?? request.headers.get("last-event-id") ?? 0) || 0;

  return runEventStream(id, afterSeq, request.signal);
}
