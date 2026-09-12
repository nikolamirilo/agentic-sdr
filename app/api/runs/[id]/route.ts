import { getRun, listLeadsForRun } from "@/lib/db/queries";
import { getRunUsage } from "@/lib/llm";
import { cancelRun, isRunActive } from "@/lib/runs/manager";
import { apiError, apiOk, handleError } from "@/lib/api";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  try {
    const run = await getRun(id);
    if (!run) return apiError("Run not found", 404);
    const leads = await listLeadsForRun(id);
    return apiOk({
      run,
      active: isRunActive(id),
      leadCount: leads.length,
      usage: await getRunUsage(id),
    });
  } catch (error) {
    return handleError(error, "GET run");
  }
}

/** Stops a run cleanly. Whatever it already found stays found. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  try {
    const cancelled = await cancelRun(id);
    if (!cancelled) return apiError("That run is not running in this process", 409);
    return apiOk({ runId: id, status: "partial" });
  } catch (error) {
    return handleError(error, "DELETE run");
  }
}
