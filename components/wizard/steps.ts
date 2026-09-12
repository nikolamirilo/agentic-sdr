import type { RunPhase } from "@/lib/db/queries";

/**
 * The rail, in order.
 *
 * Two of these belong to the product and four belong to a run. The product
 * keeps one profile and one record of where every lead landed no matter how
 * many times it is researched; everything between those two is worked through
 * once per run, which is why `scope` is on the step rather than implied by its
 * position. The rail draws the run steps as a group so it is legible which
 * four move when you switch runs.
 */
export const STEPS = [
  {
    id: 1,
    number: "01",
    scope: "product",
    label: "Product Profile",
    title: "Tell us what you sell",
    description:
      "Point us at your site and any material you have. We read it and write the profile every later step scores against.",
  },
  {
    id: 2,
    number: "02",
    scope: "run",
    label: "Research",
    title: "Set the search running",
    description:
      "Choose how many leads you want and which skills shape the search, then watch the loop work. Everything runs against the profile from step one.",
  },
  {
    id: 3,
    number: "03",
    scope: "run",
    label: "Lead Review",
    title: "Approve the leads worth contacting",
    description:
      "Only candidates that cleared the 60% bar appear here. Select the ones you want to write to.",
  },
  {
    id: 4,
    number: "04",
    scope: "run",
    label: "Communication Generation",
    title: "Write a message for every approved lead",
    description:
      "One draft per lead, each one researched for its own angle before a word is written. Nothing is sent from here.",
  },
  {
    id: 5,
    number: "05",
    scope: "run",
    label: "Outreach",
    title: "Review every message before it sends",
    description:
      "Each draft sits beside the evidence that produced it. Nothing leaves without you approving it.",
  },
  {
    id: 6,
    number: "06",
    scope: "product",
    label: "Dashboard",
    title: "Where every lead landed",
    description:
      "The record of what was found, what was sent, and what came back.",
  },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export const TOTAL_STEPS = STEPS.length;

export function stepMeta(id: StepId) {
  return STEPS.find((step) => step.id === id) ?? STEPS[0];
}

/* ------------------------------------------------------------ run phases */

/**
 * The four run phases are steps two through five. The mapping is kept explicit
 * in both directions rather than done with arithmetic, so adding a
 * product-scope step to either end cannot silently shift what a stored phase
 * means — those rows are already in the database.
 */
const STEP_BY_PHASE: Record<RunPhase, StepId> = {
  research: 2,
  lead_review: 3,
  comms: 4,
  outreach: 5,
};

const PHASE_BY_STEP: Partial<Record<StepId, RunPhase>> = {
  2: "research",
  3: "lead_review",
  4: "comms",
  5: "outreach",
};

/** The four run steps, in order, for the grouped part of the rail. */
export const RUN_STEPS = STEPS.filter((step) => step.scope === "run");

export function stepForPhase(phase: RunPhase): StepId {
  return STEP_BY_PHASE[phase] ?? 2;
}

/** Undefined for the two product-scope steps, which are not part of any run. */
export function phaseForStep(step: StepId): RunPhase | undefined {
  return PHASE_BY_STEP[step];
}

/**
 * How far into the flow a run has actually got.
 *
 * Reachability is a prefix rather than a set — there is nothing to send before
 * anything has been drafted — so this stops at the first prerequisite that has
 * not been met. Note that a run that is still going is reachable through lead
 * review: leads arrive while the loop is running, and that step is where they
 * arrive. Once drafts exist every step is open, since the dashboard needs
 * nothing outreach did not already require.
 */
export function furthestReachableStep(state: {
  hasProfile: boolean;
  hasRun: boolean;
  hasLeads: boolean;
  hasMessages: boolean;
}): StepId {
  if (!state.hasProfile) return 1;
  if (!state.hasRun) return 2;
  if (!state.hasLeads) return 3;
  if (!state.hasMessages) return 4;
  return 6;
}
