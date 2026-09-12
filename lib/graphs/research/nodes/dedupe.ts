import { computeIdentityKey, normalizeDomain } from "@/lib/identity";
import { findSeenIdentityKeys, recordCandidate } from "@/lib/db/queries";
import { emit } from "@/lib/streaming/runEvents";
import type { RawCandidate } from "@/lib/types";
import type { EnrichedCandidate, ResearchState, ResearchUpdate } from "@/lib/graphs/research/state";

/**
 * Dedupe runs before enrichment, because enrichment is the expensive step and
 * getting this order wrong multiplies the cost of a run by ten.
 *
 * The cheap heuristic filter rides along in the same pass: anything that is
 * obviously not a prospect (aggregators, directories, our own marketing) is
 * dropped here rather than after we have paid to scrape and score it.
 */

const JUNK_HOST_RE =
  /(^|\.)(wikipedia\.org|reddit\.com|quora\.com|pinterest\.|facebook\.com|instagram\.com|youtube\.com|amazon\.|ebay\.|glassdoor\.|indeed\.|crunchbase\.com|g2\.com|capterra\.com|producthunt\.com|medium\.com|substack\.com)$/i;

const JUNK_PATH_RE = /\/(tag|tags|category|categories|search|login|signup|privacy|terms)(\/|$)/i;

/**
 * Hosts that are where a person is *listed*, not where they work. A LinkedIn
 * candidate's source URL is linkedin.com, and letting that stand in as the
 * company domain would key every one of them to the same company and send
 * contact lookup after @linkedin.com addresses.
 */
const PROFILE_HOST_RE = /(^|\.)(linkedin\.com|x\.com|twitter\.com|github\.com)$/i;

function companyDomainFor(candidate: RawCandidate): string | undefined {
  if (candidate.companyDomain) return candidate.companyDomain;
  const domain = normalizeDomain(candidate.sourceUrl);
  return domain && PROFILE_HOST_RE.test(domain) ? undefined : domain;
}

function looksLikeJunk(candidate: RawCandidate): { junk: boolean; reason?: string } {
  let host: string;
  let path: string;
  try {
    const url = new URL(candidate.sourceUrl);
    host = url.hostname.replace(/^www\./, "");
    path = url.pathname;
  } catch {
    return { junk: true, reason: "unparseable source URL" };
  }
  if (JUNK_HOST_RE.test(host)) return { junk: true, reason: `aggregator or directory (${host})` };
  if (JUNK_PATH_RE.test(path)) return { junk: true, reason: "navigational page, not a company page" };
  if (!candidate.title && !candidate.company && !candidate.fullName) {
    return { junk: true, reason: "no identifiable company or person" };
  }
  return { junk: false };
}

export async function dedupe(state: ResearchState): Promise<ResearchUpdate> {
  await emit(state.runId, "node_start", { node: "dedupe" });

  const keyed: Array<{ candidate: RawCandidate; identityKey: string }> = [];
  let junked = 0;
  let unkeyed = 0;

  for (const candidate of state.candidateQueue) {
    const junk = looksLikeJunk(candidate);
    if (junk.junk) {
      junked += 1;
      continue;
    }
    const identityKey = computeIdentityKey({
      email: candidate.email,
      profileUrl: candidate.profileUrl,
      companyDomain: candidate.companyDomain,
      company: candidate.company,
      fullName: candidate.fullName,
      sourceUrl: candidate.sourceUrl,
    });
    if (!identityKey) {
      unkeyed += 1;
      continue;
    }
    keyed.push({ candidate: { ...candidate, identityKey }, identityKey });
  }

  // One indexed lookup answers "have we seen any of these people".
  const seen = await findSeenIdentityKeys(state.productId, keyed.map((k) => k.identityKey));

  // Within-batch duplicates are common: the same company on two result pages.
  // `seenKeys` covers the other case: a refined query re-surfacing someone this
  // run already rejected, which would otherwise be paid for twice.
  const withinBatch = new Set<string>(state.seenKeys);
  const survivors: EnrichedCandidate[] = [];
  let excluded = 0;
  let alreadyExamined = 0;

  for (const { candidate, identityKey } of keyed) {
    if (withinBatch.has(identityKey)) {
      if (state.seenKeys.includes(identityKey)) alreadyExamined += 1;
      continue;
    }
    withinBatch.add(identityKey);

    const previously = seen.get(identityKey);
    if (previously) {
      excluded += 1;
      await recordCandidate({
        runId: state.runId,
        productId: state.productId,
        identityKey,
        sourceUrl: candidate.sourceUrl,
        raw: candidate,
        verdict: "excluded",
        reason: previously === "lead" ? "already a lead for this product" : "on the exclusion list",
      });
      continue;
    }

    survivors.push({
      ...candidate,
      identityKey,
      companyDomain: companyDomainFor(candidate),
      contactResolved: Boolean(candidate.email),
    });
  }

  // Anything already queued from a previous turn keeps its place at the front.
  const alreadyPending = new Set(state.pending.map((c) => c.identityKey));
  const pending = [...state.pending, ...survivors.filter((c) => !alreadyPending.has(c.identityKey))];

  await emit(state.runId, "progress", {
    node: "dedupe",
    label: "Deduping",
    detail: `${survivors.length} new, ${excluded + alreadyExamined} already seen, ${junked + unkeyed} filtered out`,
    counts: {
      new: survivors.length,
      seen: excluded,
      alreadyExamined,
      junk: junked,
      unidentifiable: unkeyed,
    },
  });

  return { pending, candidateQueue: [], seenKeys: survivors.map((c) => c.identityKey) };
}
