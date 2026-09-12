import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { generateJson } from "@/lib/llm";
import { resolveSkills } from "@/lib/skills/registry";
import { renderProfile } from "@/lib/graphs/shared/prompts";
import { AngleSchema, CritiqueSchema, DraftSchema } from "@/lib/types";
import {
  getCurrentProfile,
  getLead,
  setLeadOutcome,
  updateMessage,
  upsertDraftMessage,
} from "@/lib/db/queries";
import { sendEmail } from "@/lib/providers/gmail";
import type { OutreachState, OutreachUpdate } from "@/lib/graphs/outreach/state";

export async function loadContext(state: OutreachState): Promise<OutreachUpdate> {
  const lead = state.lead ?? (await getLead(state.leadId));
  if (!lead) return { errors: [`load_context: lead ${state.leadId} not found`] };
  const profile = state.profile ?? (await getCurrentProfile(lead.productId));
  return { lead, profile, productId: lead.productId };
}

const SYSTEM = `You write cold outreach that a busy person will actually read.

Hard rules:
- Every sentence must be one that could only have been written to this person.
- Use the domain's own vocabulary. Generic business language reads as a template.
- Never invent facts, numbers, mutual connections or customer names.
- No "I hope this finds you well", no "quick question", no "circling back".
- Short. A cold email that needs scrolling does not get read.`;

/** Derives type, reason and benefit from the profile plus the lead's signal. */
export async function decideAngle(state: OutreachState): Promise<OutreachUpdate> {
  if (!state.lead) return { errors: ["decide_angle: no lead"] };

  // A user override is a decision, not a suggestion: it goes in as-is.
  if (state.angleOverride?.type && state.angleOverride.reason && state.angleOverride.benefit) {
    return { angle: state.angleOverride as z.infer<typeof AngleSchema> };
  }

  const skills = resolveSkills(state.skills, "outreach");
  const angle = await generateJson({
    schema: AngleSchema,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `Choose the angle for this email.

type: the kind of opening (for example "hiring signal", "stack fit", "funding")
reason: why this specific company, citing the signal
benefit: the one concrete thing they get, in their vocabulary

# The lead
Name: ${state.lead.fullName}
Company: ${state.lead.company ?? "unknown"}
Signal: ${state.lead.signal}
Criteria they met: ${state.lead.criteriaMet.filter((c) => c.met).map((c) => c.question).join("; ")}

${state.profile ? renderProfile(state.profile) : "(no profile available)"}

${state.angleOverride ? `The operator asked for: ${JSON.stringify(state.angleOverride)}` : ""}`,
  });

  return { angle };
}

export async function draft(state: OutreachState): Promise<OutreachUpdate> {
  if (!state.lead || !state.angle) return { errors: ["draft: missing lead or angle"] };

  const skills = resolveSkills(state.skills, "outreach");
  const examples = state.profile?.exampleEmails ?? [];

  const result = await generateJson({
    schema: DraftSchema,
    temperature: 0.7,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `Write the email.

# Angle
Type: ${state.angle.type}
Reason: ${state.angle.reason}
Benefit: ${state.angle.benefit}

# Recipient
${state.lead.fullName}${state.lead.company ? ` at ${state.lead.company}` : ""}
Signal: ${state.lead.signal}

${state.profile ? renderProfile(state.profile) : ""}

${
  examples.length > 0
    ? `# Match the tone and length of these examples\n${examples
        .map((e) => `Subject: ${e.subject}\n${e.body}`)
        .join("\n\n---\n\n")}`
    : "# No example emails were provided. Keep it under 120 words."
}`,
  });

  return { subject: result.subject, body: result.body };
}

/**
 * Checks the draft against three things: does it use domain language, does it
 * reference the actual signal, does it match the examples in tone and length.
 */
export async function critique(state: OutreachState): Promise<OutreachUpdate> {
  if (!state.body) return { errors: ["critique: nothing to critique"] };

  const terms = state.profile?.domainLanguage.terms.map((t) => t.term) ?? [];

  const result = await generateJson({
    schema: CritiqueSchema,
    temperature: 0,
    system: `You review cold emails against three specific tests and nothing else. You are strict:
a draft that would read as a template to its recipient fails.`,
    prompt: `Review this draft.

Test 1 — domain language: does it use this market's own vocabulary rather than generic
business language? Terms available: ${terms.join(", ") || "(none captured)"}
Test 2 — signal: does it reference this specific observed signal, in a way that could not
have been sent to another company? Signal: ${state.lead?.signal ?? "unknown"}
Test 3 — tone and length: ${
      (state.profile?.exampleEmails?.length ?? 0) > 0
        ? "does it match the supplied example emails?"
        : "is it under 120 words, with no filler openings?"
    }

Return pass: true only if all three pass. Otherwise list concrete fixes.

# Draft
Subject: ${state.subject}

${state.body}`,
  });

  return { critique: result };
}

export function routeAfterCritique(state: OutreachState): "revise" | "await_approval" {
  // One revise pass maximum. Two loops is enough and a third is cost with no gain.
  if (state.critique && !state.critique.pass && state.revisions < 1) return "revise";
  return "await_approval";
}

export async function revise(state: OutreachState): Promise<OutreachUpdate> {
  if (!state.body || !state.critique) return { errors: ["revise: nothing to revise"] };

  const skills = resolveSkills(state.skills, "outreach");
  const result = await generateJson({
    schema: DraftSchema,
    temperature: 0.5,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `Apply these fixes and return the whole email again. Change only what the fixes ask for.

# Fixes
${state.critique.fixes.map((f) => `- ${f}`).join("\n")}

# Current draft
Subject: ${state.subject}

${state.body}`,
  });

  return { subject: result.subject, body: result.body, revisions: 1 };
}

/**
 * Approval uses LangGraph's interrupt. The graph pauses here, its state sits in
 * the checkpointer, the UI posts approval, and the graph resumes at send.
 */
export async function awaitApproval(state: OutreachState): Promise<OutreachUpdate> {
  // Idempotent: this node runs again from the top when the graph resumes.
  const message = await upsertDraftMessage({
    leadId: state.leadId,
    threadId: state.threadId,
    subject: state.subject ?? "(no subject)",
    body: state.body ?? "",
    angle: state.angle ?? { type: "unknown", reason: "", benefit: "" },
    critique: state.critique,
  });

  const decision = interrupt<
    { messageId: string; subject: string; body: string },
    { approved: boolean; subject?: string; body?: string; notes?: string }
  >({
    messageId: message.id,
    subject: message.subject,
    body: message.body,
  });

  // Everything below runs only after the UI resumes the graph.
  const subject = decision.subject ?? state.subject;
  const body = decision.body ?? state.body;

  if (decision.subject || decision.body) {
    await updateMessage(message.id, { subject, body });
  }

  return {
    messageId: message.id,
    approved: decision.approved,
    approvalNotes: decision.notes,
    subject,
    body,
  };
}

export function routeAfterApproval(state: OutreachState): "send" | "__end__" {
  return state.approved ? "send" : "__end__";
}

export async function send(state: OutreachState): Promise<OutreachUpdate> {
  if (!state.messageId || !state.lead) return { errors: ["send: no message to send"] };

  if (!state.lead.email) {
    const error = "lead has no resolved email address";
    await updateMessage(state.messageId, { status: "failed", error });
    return { sendError: error };
  }

  try {
    const result = await sendEmail({
      productId: state.productId,
      to: state.lead.email,
      subject: state.subject ?? "",
      body: state.body ?? "",
    });
    await updateMessage(state.messageId, {
      status: "sent",
      gmailMessageId: result.gmailMessageId,
      error: null,
      sentAt: true,
    });
    await setLeadOutcome(state.leadId, "contacted");
    return { gmailMessageId: result.gmailMessageId };
  } catch (error) {
    // Mark failed with the error and do not retry blindly: a duplicate cold
    // email is worse than a missing one.
    const message = (error as Error).message;
    await updateMessage(state.messageId, { status: "failed", error: message });
    return { sendError: message };
  }
}
