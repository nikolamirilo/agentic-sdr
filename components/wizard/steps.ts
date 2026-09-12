/** The five steps, in order. The numbers here are the ones shown in the UI. */
export const STEPS = [
  {
    id: 1,
    number: "01",
    label: "Product Profile",
    title: "Tell us what you sell",
    description:
      "Point us at your site and any material you have. We read it and write the profile every later step scores against.",
  },
  {
    id: 2,
    number: "02",
    label: "Research Configuration",
    title: "Set the search running",
    description:
      "Choose how many leads you want and which skills shape the search. Everything runs against the profile from step one.",
  },
  {
    id: 3,
    number: "03",
    label: "Lead Results",
    title: "Approve the leads worth contacting",
    description:
      "Only candidates that cleared the 60% bar appear here. Select the ones you want to write to.",
  },
  {
    id: 4,
    number: "04",
    label: "Outreach Review",
    title: "Review every message before it sends",
    description:
      "One draft per approved lead, with the evidence that produced it alongside. Nothing sends without you.",
  },
  {
    id: 5,
    number: "05",
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

/**
 * How far into the flow a product has actually got.
 *
 * Reachability is a prefix rather than a set — step five means nothing without
 * the drafts step four produces — so this stops at the first prerequisite the
 * product has not met. Each condition is the one the step itself enforces:
 * step one hands off once a profile exists, step three reads leads off a run,
 * and step four has nothing to review until drafts were written. Once drafts
 * exist the last two steps are both reachable, since the dashboard needs
 * nothing step four did not already require.
 */
export function furthestReachableStep(product: {
  hasProfile: boolean;
  hasRun: boolean;
  hasMessages: boolean;
}): StepId {
  if (!product.hasProfile) return 1;
  if (!product.hasRun) return 2;
  if (!product.hasMessages) return 3;
  return 5;
}
