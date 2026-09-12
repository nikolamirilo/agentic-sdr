import { z } from "zod";
import crypto from "node:crypto";
import { getOutreachGraph } from "@/lib/graphs/outreach/graph";
import type { OutreachState } from "@/lib/graphs/outreach/state";
import { OUTREACH_NODE_LABELS, labelFor } from "@/lib/graphs/shared/narrate";
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
 *
 * Narrated the same way profile generation is: node transitions go down the
 * wire as they happen, and the `done` frame carries exactly the JSON this route
 * used to return whole. Drafting a batch is minutes of model calls, and a
 * spinner with nothing behind it is indistinguishable from a hang.
 *
 * The nodes also write the same story into `run_events` under the session id, so
 * the log outlives the request — the browser can reconnect to
 * `/api/runs/:sessionId/stream` and replay it, exactly as a research run does.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, OutreachSchema);
  if (!parsed.ok) return parsed.response;

  if (!hasModelProvider()) {
    return apiError("No model provider is configured.", 503);
  }

  const { leadIds, skillIds, angleOverride } = parsed.data;

  // One session for the whole batch, so every lead narrates into one stream.
  const sessionId = crypto.randomUUID();

  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: string, data: unknown) => {
        try {
          controller.enqueue(frame(event, data));
        } catch {
          /* client went away; the drafting still finishes */
        }
      };

      push("open", {
        sessionId,
        leadIds,
        nodes: Object.keys(OUTREACH_NODE_LABELS),
      });

      const drafted: Array<{ leadId: string; messageId?: string; error?: string }> = [];

      try {
        const graph = await getOutreachGraph();
        const skills = await loadSkills(skillIds);

        for (const [index, leadId] of leadIds.entries()) {
          const lead = await getLead(leadId);
          if (!lead) {
            drafted.push({ leadId, error: "lead not found" });
            push("lead_error", { leadId, error: "lead not found" });
            continue;
          }

          push("lead_start", {
            leadId,
            leadName: lead.fullName,
            company: lead.company,
            index: index + 1,
            total: leadIds.length,
          });

          try {
            const profile = await getCurrentProfile(lead.productId);

            // A fresh thread per drafting attempt. Reusing the lead id would make a
            // second request resume the old interrupt instead of re-drafting, so an
            // edited profile would never take effect.
            const threadId = crypto.randomUUID();
            const config = { configurable: { thread_id: threadId }, recursionLimit: 25 };

            const updates = await graph.stream(
              {
                runId: sessionId,
                leadId,
                threadId,
                productId: lead.productId,
                lead,
                profile,
                skills,
                angleOverride,
              },
              { ...config, streamMode: "updates" }
            );

            let values: Partial<OutreachState> = {};

            for await (const chunk of updates) {
              for (const [node, update] of Object.entries(
                chunk as Record<string, Partial<OutreachState>>
              )) {
                // The interrupt arrives as a chunk like any other; it is the
                // graph parking at approval, not a node that ran.
                if (node === "__interrupt__") {
                  push("interrupt", { leadId, leadName: lead.fullName });
                  continue;
                }
                values = { ...values, ...update };
                push("node", {
                  leadId,
                  leadName: lead.fullName,
                  node,
                  label: labelFor("outreach", node),
                  summary: summarize(node, update),
                  errors: update.errors ?? [],
                });
              }
            }

            const state = await graph.getState(config);
            const interrupted = (state.tasks ?? []).some((task) => (task.interrupts ?? []).length > 0);

            const messageId =
              values.messageId ?? (state.values as { messageId?: string }).messageId;

            if (!interrupted && !messageId) {
              drafted.push({ leadId, error: "the graph finished without producing a draft" });
              push("lead_error", { leadId, error: "the graph finished without producing a draft" });
              continue;
            }
            drafted.push({ leadId, messageId });
            push("lead_done", { leadId, leadName: lead.fullName, messageId });
          } catch (error) {
            const message = (error as Error).message;
            drafted.push({ leadId, error: message });
            push("lead_error", { leadId, error: message });
          }
        }

        const messages = await listMessagesForLeads(leadIds);
        // The same payload the route used to return, so the client keeps reading
        // `drafted` and `messages` off one object.
        push("done", { sessionId, drafted, messages });
      } catch (error) {
        push("error", { message: (error as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** One line per node, in the same spirit as the profile route's summarize. */
function summarize(node: string, update: Partial<OutreachState>): string {
  switch (node) {
    case "load_context":
      return update.lead ? `${update.lead.fullName} loaded` : "";
    case "decide_angle":
      return update.angle ? `${update.angle.type} — ${update.angle.reason}` : "";
    case "draft":
    case "revise":
      return update.subject ? `"${update.subject}"` : "";
    case "critique_draft":
      if (!update.critique) return "";
      return update.critique.pass
        ? "passed all three tests"
        : `${update.critique.fixes.length} fixes: ${update.critique.fixes.join("; ")}`;
    case "await_approval":
      return update.messageId ? "draft saved, waiting for approval" : "";
    case "send":
      return update.sendError ? `failed: ${update.sendError}` : "sent";
    default:
      return "";
  }
}
