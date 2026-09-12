import { z } from "zod";
import crypto from "node:crypto";
import { getOutreachGraph } from "@/lib/graphs/outreach/graph";
import { getCurrentProfile, getLead, listMessagesForLeads } from "@/lib/db/queries";
import { loadSkills } from "@/lib/skills/registry";
import { hasModelProvider } from "@/lib/llm";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

const OutreachSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(20),
  skillIds: z.array(z.string().uuid()).max(5).default([]),
  angleOverride: z
    .object({ type: z.string(), reason: z.string(), benefit: z.string() })
    .partial()
    .optional(),
});

export async function GET(request: Request) {
  const leadIds = new URL(request.url).searchParams.getAll("leadId");
  if (leadIds.length === 0) return apiError("At least one leadId is required", 400);
  try {
    return apiOk({ messages: await listMessagesForLeads(leadIds) });
  } catch (error) {
    return handleError(error, "GET /api/outreach");
  }
}

/**
 * Drafts a message per lead. Each graph runs to the approval interrupt and
 * stops there with its state in the checkpointer; nothing is sent from here.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, OutreachSchema);
  if (!parsed.ok) return parsed.response;

  if (!hasModelProvider()) {
    return apiError("No model provider is configured.", 503);
  }

  try {
    const graph = await getOutreachGraph();
    const skills = await loadSkills(parsed.data.skillIds);

    const drafted: Array<{ leadId: string; messageId?: string; error?: string }> = [];

    for (const leadId of parsed.data.leadIds) {
      const lead = await getLead(leadId);
      if (!lead) {
        drafted.push({ leadId, error: "lead not found" });
        continue;
      }

      try {
        const profile = await getCurrentProfile(lead.productId);

        // A fresh thread per drafting attempt. Reusing the lead id would make a
        // second request resume the old interrupt instead of re-drafting, so an
        // edited profile would never take effect.
        const threadId = crypto.randomUUID();
        const config = { configurable: { thread_id: threadId }, recursionLimit: 25 };

        const result = await graph.invoke(
          {
            leadId,
            threadId,
            productId: lead.productId,
            lead,
            profile,
            skills,
            angleOverride: parsed.data.angleOverride,
          },
          config
        );

        const state = await graph.getState(config);
        const interrupted = (state.tasks ?? []).some((task) => (task.interrupts ?? []).length > 0);

        const messageId =
          (result as { messageId?: string }).messageId ??
          (state.values as { messageId?: string }).messageId;

        if (!interrupted && !messageId) {
          drafted.push({ leadId, error: "the graph finished without producing a draft" });
          continue;
        }
        drafted.push({ leadId, messageId });
      } catch (error) {
        drafted.push({ leadId, error: (error as Error).message });
      }
    }

    const messages = await listMessagesForLeads(parsed.data.leadIds);
    return apiOk({ drafted, messages }, 201);
  } catch (error) {
    return handleError(error, "POST /api/outreach");
  }
}
