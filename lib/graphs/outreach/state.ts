import { Annotation } from "@langchain/langgraph";
import type { Angle, Critique, Lead, ProductProfile, Skill } from "@/lib/types";

export const OutreachStateAnnotation = Annotation.Root({
  leadId: Annotation<string>,
  productId: Annotation<string>,
  /**
   * The drafting session this lead belongs to. One session covers the whole
   * batch the operator asked for, so every lead's nodes narrate into the same
   * `run_events` stream and the UI tails one feed rather than N. Optional: the
   * graph still runs without it, just without a stream to write to.
   */
  runId: Annotation<string | undefined>,
  /** One checkpoint thread per drafting attempt, so re-drafting starts clean. */
  threadId: Annotation<string>,
  lead: Annotation<Lead | undefined>,
  profile: Annotation<ProductProfile | undefined>,
  skills: Annotation<Skill[]>({ reducer: (_, b) => b, default: () => [] }),

  /** User overrides land here before decide_angle runs. */
  angleOverride: Annotation<Partial<Angle> | undefined>,
  angle: Annotation<Angle | undefined>,

  subject: Annotation<string | undefined>,
  body: Annotation<string | undefined>,
  critique: Annotation<Critique | undefined>,
  revisions: Annotation<number>({ reducer: (a: number, b: number) => a + b, default: () => 0 }),

  approved: Annotation<boolean | undefined>,
  approvalNotes: Annotation<string | undefined>,
  messageId: Annotation<string | undefined>,
  gmailMessageId: Annotation<string | undefined>,
  sendError: Annotation<string | undefined>,
  errors: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => [...left, ...right],
    default: () => [],
  }),
});

export type OutreachState = typeof OutreachStateAnnotation.State;
export type OutreachUpdate = typeof OutreachStateAnnotation.Update;
