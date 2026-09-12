import { Annotation } from "@langchain/langgraph";
import type { Lead, ProductProfile, RawCandidate, ScoredCandidate, Skill } from "@/lib/types";
import type { PeopleSearchFilters } from "@/lib/providers/types";

export type EnrichedCandidate = RawCandidate & {
  identityKey: string;
  /** The page we read for this candidate, kept so scoring has real evidence. */
  pageText?: string;
  contactResolved: boolean;
};

const replace = <T,>(fallback: () => T) => ({
  reducer: (_left: T, right: T) => right,
  default: fallback,
});

const counter = {
  reducer: (left: number, right: number) => left + right,
  default: () => 0,
};

export const ResearchStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  productId: Annotation<string>,
  profile: Annotation<ProductProfile | undefined>,
  /** False runs the control arm: same loop, no profile. Powers the comparison view. */
  useProfile: Annotation<boolean>({ reducer: (_, b) => b, default: () => true }),
  targetCount: Annotation<number>,
  skills: Annotation<Skill[]>({ reducer: (_, b) => b, default: () => [] }),

  queries: Annotation<string[]>(replace<string[]>(() => [])),
  /**
   * LinkedIn facets for the same slice of the ICP the queries target. Separate
   * from `queries` because Up2Data takes structured filters, not a query string —
   * and because refine_queries rewrites prose while these stay comparatively
   * stable. Undefined means the LinkedIn search sits this run out.
   */
  linkedinFilters: Annotation<PeopleSearchFilters | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  queriesTried: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => [...new Set([...left, ...right])],
    default: () => [],
  }),
  /** Raw discovery output awaiting dedupe. discover appends, dedupe drains. */
  candidateQueue: Annotation<RawCandidate[]>(replace<RawCandidate[]>(() => [])),
  /**
   * Every identity this run has already put through the loop. `candidates` rows
   * record the same thing durably, but keeping it in state means dedupe does not
   * pay for a second query per turn — and without it the loop would re-enrich and
   * re-score candidates it already rejected.
   */
  seenKeys: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => [...new Set([...left, ...right])],
    default: () => [],
  }),
  /** Deduped but not yet enriched. Survives across loop turns so nothing discovered is wasted. */
  pending: Annotation<EnrichedCandidate[]>(replace<EnrichedCandidate[]>(() => [])),
  /** The batch enriched this turn. Replaced each turn. */
  enriched: Annotation<EnrichedCandidate[]>(replace<EnrichedCandidate[]>(() => [])),
  scored: Annotation<ScoredCandidate[]>(replace<ScoredCandidate[]>(() => [])),
  survivors: Annotation<ScoredCandidate[]>(replace<ScoredCandidate[]>(() => [])),

  found: Annotation<Lead[]>({
    reducer: (left: Lead[], right: Lead[]) => [...left, ...right],
    default: () => [],
  }),
  examinedCount: Annotation<number>(counter),
  /** Feeds refine_queries: which criterion is failing, and how often. */
  rejectionReasons: Annotation<Record<string, number>>({
    reducer: (left, right) => {
      const merged = { ...left };
      for (const [key, value] of Object.entries(right)) merged[key] = (merged[key] ?? 0) + value;
      return merged;
    },
    default: () => ({}),
  }),
  /** What refine_queries decided and why. Surfaced in the UI. */
  lastRefinement: Annotation<string | undefined>,
  iterations: Annotation<number>(counter),

  startedAt: Annotation<number>({ reducer: (_, b) => b, default: () => Date.now() }),
  budget: Annotation<{ maxCandidates: number; maxSeconds: number }>({
    reducer: (_, b) => b,
    default: () => ({ maxCandidates: 120, maxSeconds: 600 }),
  }),
  /** done | partial — set by check_done, read by the run manager. */
  outcome: Annotation<"done" | "partial" | undefined>,
  stopReason: Annotation<string | undefined>,
  errors: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => [...left, ...right],
    default: () => [],
  }),
});

export type ResearchState = typeof ResearchStateAnnotation.State;
export type ResearchUpdate = typeof ResearchStateAnnotation.Update;
