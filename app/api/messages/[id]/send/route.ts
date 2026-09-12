import { getMessage, getLead, setLeadOutcome, updateMessage } from "@/lib/db/queries";
import { gmailConfigured, sendEmail } from "@/lib/providers/gmail";
import { apiError, apiOk, handleError } from "@/lib/api";

/**
 * Direct send, for a message that was approved without resuming the graph.
 * On failure the message is marked failed with the error and is not retried:
 * a duplicate cold email is worse than a missing one.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/messages/[id]/send">) {
  const { id } = await ctx.params;

  try {
    if (!gmailConfigured()) return apiError("Gmail is not configured on this deployment", 503);

    const message = await getMessage(id);
    if (!message) return apiError("Message not found", 404);
    if (message.status === "sent") return apiError("That message has already been sent", 409);

    const lead = await getLead(message.leadId);
    if (!lead) return apiError("The lead behind this message is gone", 404);
    if (!lead.email) return apiError("This lead has no resolved email address", 422);

    try {
      const result = await sendEmail({
        productId: lead.productId,
        to: lead.email,
        subject: message.subject,
        body: message.body,
      });
      await updateMessage(id, {
        status: "sent",
        gmailMessageId: result.gmailMessageId,
        error: null,
        sentAt: true,
      });
      await setLeadOutcome(lead.id, "contacted");
      return apiOk({ message: await getMessage(id), from: result.from });
    } catch (error) {
      const detail = (error as Error).message;
      await updateMessage(id, { status: "failed", error: detail });
      return apiError(detail, 502, { message: await getMessage(id) });
    }
  } catch (error) {
    return handleError(error, "POST send");
  }
}
