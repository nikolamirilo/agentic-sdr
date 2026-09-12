import { z } from "zod";
import { RUN_PHASES, getRun, listLeadsForRun, setRunPhase } from "@/lib/db/queries";
import { getRunUsage } from "@/lib/llm";
import { cancelRun, isRunActive } from "@/lib/runs/manager";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

const PhaseSchema = z.object({ phase: z.enum(RUN_PHASES) });

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

/**
 * Records the phase the user moved to. Fire-and-forget from the browser: the
 * rail has already moved by the time this lands, and a failed write costs a
 * resume position, not the work.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, PhaseSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const run = await getRun(id);
    if (!run) return apiError("Run not found", 404);
    await setRunPhase(id, parsed.data.phase);
    return apiOk({ runId: id, phase: parsed.data.phase });
  } catch (error) {
    return handleError(error, "PATCH run");
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
