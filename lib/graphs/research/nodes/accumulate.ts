import { emit } from "@/lib/streaming/runEvents";
import {
  insertLead,
  recordBillingEvent,
  recordCandidate,
  updateRunProgress,
} from "@/lib/db/queries";
import type { Lead } from "@/lib/types";
import type { ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * Push survivors into `found`, insert into `leads`, write a billing event, and
 * emit a `lead` run event so the browser sees it the moment it lands.
 */
export async function accumulate(state: ResearchState): Promise<ResearchUpdate> {
  await emit(state.runId, "node_start", { node: "accumulate" });

  const found: Lead[] = [];
  const remaining = Math.max(0, state.targetCount - state.found.length);

  for (const candidate of state.survivors.slice(0, remaining)) {
    const name =
      candidate.fullName?.trim() ||
      candidate.company?.trim() ||
      candidate.title?.trim() ||
      "Unnamed contact";

    const lead = await insertLead({
      productId: state.productId,
      runId: state.runId,
      identityKey: candidate.identityKey,
      fullName: name,
      email: candidate.email,
      phone: candidate.phone,
      profileUrl: candidate.profileUrl ?? candidate.sourceUrl,
      company: candidate.company,
      signal: candidate.signal,
      relevance: candidate.relevance,
      criteriaMet: candidate.answers,
      evidence: candidate.evidence ?? {},
    });

    // A null return means another run inserted this identity first. That is the
    // unique index doing its job, not an error.
    if (!lead) continue;

    await recordCandidate({
      runId: state.runId,
      productId: state.productId,
      identityKey: candidate.identityKey,
      sourceUrl: candidate.sourceUrl,
      raw: candidate,
      score: candidate.relevance,
      verdict: "qualified",
      reason: candidate.signal,
    });
    await recordBillingEvent({
      productId: state.productId,
      runId: state.runId,
      kind: "lead_found",
    });

    found.push(lead);
    await emit(state.runId, "lead", {
      lead: {
        id: lead.id,
        fullName: lead.fullName,
        company: lead.company,
        email: lead.email,
        profileUrl: lead.profileUrl,
        signal: lead.signal,
        relevance: lead.relevance,
        contactResolved: Boolean(lead.email),
      },
    });
  }

  const totalFound = state.found.length + found.length;
  await updateRunProgress(state.runId, {
    foundCount: totalFound,
    examinedCount: state.examinedCount,
  });

  await emit(state.runId, "progress", {
    node: "accumulate",
    label: "Qualifying",
    detail: `found ${totalFound} of ${state.targetCount}`,
    found: totalFound,
    target: state.targetCount,
    examined: state.examinedCount,
  });

  return { found, survivors: [] };
}
