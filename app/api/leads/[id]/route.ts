import { z } from "zod";
import { getLead, setLeadOutcome } from "@/lib/db/queries";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

/** The outcomes the dashboard tracks, in the order a deal moves through them. */
export const OUTCOMES = ["not_contacted", "contacted", "replied", "meeting_booked"] as const;

const PatchLeadSchema = z.object({
  outcome: z.enum(OUTCOMES),
});

export async function GET(_request: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  try {
    const lead = await getLead(id);
    if (!lead) return apiError("Lead not found", 404);
    return apiOk({ lead });
  } catch (error) {
    return handleError(error, "GET lead");
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, PatchLeadSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const lead = await getLead(id);
    if (!lead) return apiError("Lead not found", 404);

    await setLeadOutcome(id, parsed.data.outcome);
    return apiOk({ lead: await getLead(id) });
  } catch (error) {
    return handleError(error, "PATCH lead");
  }
}
