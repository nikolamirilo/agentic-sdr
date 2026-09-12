import { getRun, listLeadsForRun } from "@/lib/db/queries";
import { apiError, apiOk, handleError } from "@/lib/api";

/** Qualified leads only. Rejections live in `candidates` and are never shown. */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]/leads">) {
  const { id } = await ctx.params;
  try {
    const run = await getRun(id);
    if (!run) return apiError("Run not found", 404);
    return apiOk({ leads: await listLeadsForRun(id), run });
  } catch (error) {
    return handleError(error, "GET run leads");
  }
}
