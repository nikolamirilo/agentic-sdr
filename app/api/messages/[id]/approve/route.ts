import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { getOutreachGraph } from "@/lib/graphs/outreach/graph";
import { getMessage, updateMessage } from "@/lib/db/queries";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

const ApproveSchema = z.object({
  approved: z.boolean().default(true),
  /** Operator edits applied before sending. */
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(20_000).optional(),
  notes: z.string().max(2000).optional(),
  /** false stops at approved without sending, for a two-step review. */
  send: z.boolean().default(true),
});

/**
 * Resumes the interrupted graph. The state has been sitting in the checkpointer
 * since the draft was written; this hands it the approval decision and lets it
 * continue at `send`.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/[id]/approve">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, ApproveSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const message = await getMessage(id);
    if (!message) return apiError("Message not found", 404);
    if (message.status === "sent") return apiError("That message has already been sent", 409);

    if (!parsed.data.approved) {
      await updateMessage(id, {
        status: "draft",
        subject: parsed.data.subject,
        body: parsed.data.body,
        error: null,
      });
      return apiOk({ message: await getMessage(id), resumed: false });
    }

    // Approve-only: record the decision without waking the graph.
    if (!parsed.data.send) {
      await updateMessage(id, {
        status: "approved",
        subject: parsed.data.subject,
        body: parsed.data.body,
        error: null,
      });
      return apiOk({ message: await getMessage(id), resumed: false });
    }

    const graph = await getOutreachGraph();
    const config = { configurable: { thread_id: message.threadId }, recursionLimit: 25 };

    const state = await graph.getState(config);
    const interrupted = (state.tasks ?? []).some((task) => (task.interrupts ?? []).length > 0);
    if (!interrupted) {
      return apiError(
        "This draft is not waiting for approval. Its graph state is gone — re-draft the message.",
        409
      );
    }

    await graph.invoke(
      new Command({
        resume: {
          approved: true,
          subject: parsed.data.subject,
          body: parsed.data.body,
          notes: parsed.data.notes,
        },
      }),
      config
    );

    return apiOk({ message: await getMessage(id), resumed: true });
  } catch (error) {
    return handleError(error, "POST approve");
  }
}
