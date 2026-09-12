import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { generateJson } from "@/lib/llm";
import { resolveSkills } from "@/lib/skills/registry";
import { renderProfile } from "@/lib/graphs/shared/prompts";
import { narrator } from "@/lib/graphs/shared/narrate";
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

/**
 * Every node narrates through here. One drafting session covers a batch of
 * leads, so the lead is carried on every line — a feed of "Writing the draft"
 * with nothing attached is unreadable once there is more than one.
 */
const logFor = (state: OutreachState) =>
  narrator(state.runId, "outreach", {
    leadId: state.leadId,
    leadName: state.lead?.fullName,
    company: state.lead?.company ?? undefined,
  });

export async function loadContext(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("load_context");

  const lead = state.lead ?? (await getLead(state.leadId));
  if (!lead) {
    await log.fail("load_context", `lead ${state.leadId} not found`);
    return { errors: [`load_context: lead ${state.leadId} not found`] };
  }
  const profile = state.profile ?? (await getCurrentProfile(lead.productId));

  await log.end(
    "load_context",
    `${lead.fullName}${lead.company ? ` at ${lead.company}` : ""} — ` +
      (profile ? `profile v${profile.version}` : "no profile, the angle will be thin") +
      (lead.email ? "" : ", no email on file"),
    {
      leadName: lead.fullName,
      company: lead.company,
      profileVersion: profile?.version,
      hasEmail: Boolean(lead.email),
      signal: lead.signal,
      relevance: lead.relevance,
    }
  );

  return { lead, profile, productId: lead.productId };
}

const SYSTEM = `You write cold outreach that a busy person will actually read.

Hard rules:
- Every sentence must be one that could only have been written to this person.
- Use the domain's own vocabulary. Generic business language reads as a template.
- Never invent facts, numbers, mutual connections or customer names.
- No "I hope this finds you well", no "quick question", no "circling back".
- Short. A cold email that needs scrolling does not get read.`;

/**
 * The shape of the output, stated in the user prompt so it sits after any
 * skill instructions. Without it the model writes an account-research memo:
 * no greeting, the company described in the third person, no sign-off.
 */
function emailFormat(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? "";
  return `# Format — this is a personal email from one person to another
- The body starts with the greeting on its own line: "Hi ${firstName}," (if "${fullName}" is not a
  person's name, use "Hello,"). A skill's "first sentence" means the first sentence after it.
- Write to the recipient in the second person: "you", "your team", "your P&C core". Never describe
  their company in the third person as if briefing someone else about it.
- First person singular for the sender: "I", not "we" and not the product's name as the subject.
- Plain sentences a person would type. No headline fragments, no colons or semicolons stitching
  clauses together, no stacked product feature lists. Mention at most one or two capabilities.
- Two to four short paragraphs separated by a blank line.
- End with a question they can answer in one line, then a sign-off on its own line ("Best,").
  Do not write a sender name or signature under it.
- Subject: under 8 words, lowercase except proper nouns, reads like a colleague wrote it.
  No colons, no title case, no clickbait.`;
}

/** Derives type, reason and benefit from the profile plus the lead's signal. */
export async function decideAngle(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("decide_angle");

  if (!state.lead) {
    await log.fail("decide_angle", "no lead in state");
    return { errors: ["decide_angle: no lead"] };
  }

  // A user override is a decision, not a suggestion: it goes in as-is.
  if (state.angleOverride?.type && state.angleOverride.reason && state.angleOverride.benefit) {
    await log.end("decide_angle", `operator override: ${state.angleOverride.type}`, {
      overridden: true,
      angle: state.angleOverride,
    });
    return { angle: state.angleOverride as z.infer<typeof AngleSchema> };
  }

  const skills = resolveSkills(state.skills, "outreach");
  const angle = await generateJson({
    schema: AngleSchema,
    runId: state.runId,
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

  // The angle is the profile earning its keep: type, reason and benefit are
  // derived rather than asked of the user, so they are worth showing.
  await log.end("decide_angle", `${angle.type} — ${angle.reason}`, {
    angle,
    derivedFrom: state.profile ? `profile v${state.profile.version}` : "no profile",
    skills: skills.names,
  });

  return { angle };
}

export async function draft(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("draft");

  if (!state.lead || !state.angle) {
    await log.fail("draft", "missing lead or angle");
    return { errors: ["draft: missing lead or angle"] };
  }

  const skills = resolveSkills(state.skills, "outreach");
  const examples = state.profile?.exampleEmails ?? [];

  const result = await generateJson({
    schema: DraftSchema,
    runId: state.runId,
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
}

${emailFormat(state.lead.fullName)}`,
  });

  const words = result.body.trim().split(/\s+/).length;
  await log.end("draft", `"${result.subject}" — ${words} words`, {
    subject: result.subject,
    words,
    examplesUsed: examples.length,
  });

  return { subject: result.subject, body: result.body };
}

/**
 * Checks the draft against three things: does it use domain language, does it
 * reference the actual signal, does it match the examples in tone and length.
 */
export async function critique(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("critique_draft");

  if (!state.body) {
    await log.fail("critique_draft", "nothing to critique");
    return { errors: ["critique: nothing to critique"] };
  }

  const terms = state.profile?.domainLanguage.terms.map((t) => t.term) ?? [];

  const result = await generateJson({
    schema: CritiqueSchema,
    runId: state.runId,
    temperature: 0,
    system: `You review cold emails against four specific tests and nothing else. You are strict:
a draft that would read as a template, or not as an email at all, fails.`,
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
Test 4 — reads as an email: does the body open with a greeting line to ${
      state.lead?.fullName ?? "the recipient"
    }, speak to them as "you" rather than describing their company in the third person, use
plain sentences instead of headline fragments or feature lists, and end with a question and a
sign-off? A draft that reads like an account-research note fails, however accurate it is.
Fold any failure here into matchesToneAndLength.

Using domain vocabulary never justifies jargon stacking: a sentence the recipient would have to
reread fails Test 1 as well.

Return pass: true only if all four pass. Otherwise list concrete fixes.

# Draft
Subject: ${state.subject}

${state.body}`,
  });

  /**
   * The routing decision is taken in `routeAfterCritique`, which is sync and
   * cannot log. So it is spelled out here instead — a critique that fails on the
   * last allowed revision still goes to approval, and that is exactly the case
   * an operator would otherwise mistake for the fixes having been applied.
   */
  const willRevise = !result.pass && state.revisions < 1;
  await log.end(
    "critique_draft",
    result.pass
      ? "passed all four tests"
      : `failed: ${result.fixes.join("; ")} → ` +
        (willRevise ? "revising" : "out of revisions, going to approval as-is"),
    { pass: result.pass, fixes: result.fixes, willRevise, revisions: state.revisions }
  );

  return { critique: result };
}

export function routeAfterCritique(state: OutreachState): "revise" | "await_approval" {
  // One revise pass maximum. Two loops is enough and a third is cost with no gain.
  if (state.critique && !state.critique.pass && state.revisions < 1) return "revise";
  return "await_approval";
}

export async function revise(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("revise", `${state.critique?.fixes.length ?? 0} fixes to apply`);

  if (!state.body || !state.critique) {
    await log.fail("revise", "nothing to revise");
    return { errors: ["revise: nothing to revise"] };
  }

  const skills = resolveSkills(state.skills, "outreach");
  const result = await generateJson({
    schema: DraftSchema,
    runId: state.runId,
    temperature: 0.5,
    system: skills.instructions ? `${SYSTEM}\n\n# Active skills\n${skills.instructions}` : SYSTEM,
    prompt: `Apply these fixes and return the whole email again. Change only what the fixes ask for.

# Fixes
${state.critique.fixes.map((f) => `- ${f}`).join("\n")}

# Current draft
Subject: ${state.subject}

${state.body}

${emailFormat(state.lead?.fullName ?? "")}`,
  });

  const words = result.body.trim().split(/\s+/).length;
  await log.end("revise", `rewritten — "${result.subject}", ${words} words`, {
    subject: result.subject,
    words,
    fixes: state.critique.fixes,
  });

  return { subject: result.subject, body: result.body, revisions: 1 };
}

/**
 * Approval uses LangGraph's interrupt. The graph pauses here, its state sits in
 * the checkpointer, the UI posts approval, and the graph resumes at send.
 */
export async function awaitApproval(state: OutreachState): Promise<OutreachUpdate> {
  const log = logFor(state);
  await log.start("await_approval");

  // Idempotent: this node runs again from the top when the graph resumes.
  const message = await upsertDraftMessage({
    leadId: state.leadId,
    threadId: state.threadId,
    subject: state.subject ?? "(no subject)",
    body: state.body ?? "",
    angle: state.angle ?? { type: "unknown", reason: "", benefit: "" },
    critique: state.critique,
  });

  // The line the feed ends on for a drafting run: everything past here happens
  // in a *later* request, after a person has looked at the draft.
  await log.progress("await_approval", "draft saved, waiting for the operator", {
    messageId: message.id,
    subject: message.subject,
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

  const edited = Boolean(decision.subject || decision.body);
  if (edited) {
    await updateMessage(message.id, { subject, body });
  }

  await log.end(
    "await_approval",
    decision.approved
      ? `approved${edited ? " with operator edits" : ""}`
      : "rejected by the operator",
    { approved: decision.approved, edited, notes: decision.notes, messageId: message.id }
  );

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
  const log = logFor(state);
  await log.start("send");

  if (!state.messageId || !state.lead) {
    await log.fail("send", "no message to send");
    return { errors: ["send: no message to send"] };
  }

  if (!state.lead.email) {
    const error = "lead has no resolved email address";
    await updateMessage(state.messageId, { status: "failed", error });
    await log.fail("send", error, { messageId: state.messageId });
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
    await log.end("send", `sent to ${state.lead.email}`, {
      to: state.lead.email,
      gmailMessageId: result.gmailMessageId,
      messageId: state.messageId,
    });
    return { gmailMessageId: result.gmailMessageId };
  } catch (error) {
    // Mark failed with the error and do not retry blindly: a duplicate cold
    // email is worse than a missing one.
    const message = (error as Error).message;
    await updateMessage(state.messageId, { status: "failed", error: message });
    await log.fail("send", message, { to: state.lead.email, messageId: state.messageId });
    return { sendError: message };
  }
}
