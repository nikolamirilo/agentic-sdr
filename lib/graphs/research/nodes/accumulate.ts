import { emit } from "@/lib/streaming/runEvents";
import { narrator } from "@/lib/graphs/shared/narrate";
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
  const log = narrator(state.runId, "research");
  await log.start("accumulate", `${state.survivors.length} qualified this turn`, {
    survivors: state.survivors.length,
  });

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
    if (!lead) {
      await log.progress("accumulate", `${name} was claimed by another run first`, {
        identityKey: candidate.identityKey,
        skipped: "duplicate",
      });
      continue;
    }

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

  const dropped = state.survivors.length - found.length;
  await log.end(
    "accumulate",
    `+${found.length} qualified — ${totalFound} of ${state.targetCount} found` +
      (dropped > 0 ? `, ${dropped} over target or already claimed` : ""),
    {
      added: found.length,
      found: totalFound,
      target: state.targetCount,
      examined: state.examinedCount,
    }
  );

  return { found, survivors: [] };
}
