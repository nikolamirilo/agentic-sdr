import { z } from "zod";

// --- product profile ------------------------------------------------------

export const ProductDefinitionSchema = z.object({
  name: z.string(),
  oneLiner: z.string(),
  whatItDoes: z.string(),
  problemsSolved: z.array(z.string()),
  capabilities: z.array(z.string()),
  pricingModel: z.string().optional(),
  differentiators: z.array(z.string()),
});
export type ProductDefinition = z.infer<typeof ProductDefinitionSchema>;

export const IcpSchema = z.object({
  summary: z.string(),
  companyTypes: z.array(z.string()),
  industries: z.array(z.string()),
  companySize: z.string(),
  geographies: z.array(z.string()),
  buyerRoles: z.array(z.string()),
  triggerSignals: z.array(z.string()),
  exampleCustomerUrls: z.array(z.string()).default([]),
});
export type Icp = z.infer<typeof IcpSchema>;

export const DomainKnowledgeSchema = z.object({
  marketSummary: z.string(),
  competitors: z.array(z.string()),
  commonWorkflows: z.array(z.string()),
  painPoints: z.array(z.string()),
});
export type DomainKnowledge = z.infer<typeof DomainKnowledgeSchema>;

/**
 * Every term carries the URL it was observed on. A term with no evidence is
 * dropped — that is what stops this field from becoming marketing vocabulary.
 */
export const DomainTermSchema = z.object({
  term: z.string(),
  meaning: z.string(),
  evidenceUrl: z.string(),
});
export type DomainTerm = z.infer<typeof DomainTermSchema>;

export const DisqualifierSchema = z.object({
  id: z.string(),
  rule: z.string(),
  rationale: z.string(),
});
export type Disqualifier = z.infer<typeof DisqualifierSchema>;

/** Yes-or-no questions answerable from a candidate's public footprint. */
export const CriterionSchema = z.object({
  id: z.string(),
  question: z.string(),
  weight: z.number().min(1).max(5),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const ExampleEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
export type ExampleEmail = z.infer<typeof ExampleEmailSchema>;

export type ProductProfile = {
  id: string;
  productId: string;
  version: number;
  productDefinition: ProductDefinition;
  icp: Icp;
  domainKnowledge: DomainKnowledge;
  domainLanguage: { terms: DomainTerm[] };
  disqualifiers: Disqualifier[];
  scoringCriteria: Criterion[];
  exampleEmails: ExampleEmail[];
  createdAt: string;
};

// --- research -------------------------------------------------------------

export type RawCandidate = {
  identityKey?: string;
  fullName?: string;
  company?: string;
  companyDomain?: string;
  role?: string;
  email?: string;
  phone?: string;
  profileUrl?: string;
  sourceUrl: string;
  title?: string;
  snippet?: string;
  signal?: string;
  evidence?: Record<string, unknown>;
  query?: string;
};

export type CriterionAnswer = {
  id: string;
  question: string;
  weight: number;
  met: boolean;
  evidence: string;
};

export type ScoredCandidate = RawCandidate & {
  identityKey: string;
  /** Always measured against the profile's criteria when a profile exists. */
  relevance: number;
  answers: CriterionAnswer[];
  signal: string;
  /**
   * Whether this candidate passes its own arm's gate. Normally that is just
   * `relevance >= 0.60`. The control arm sets it from its own free-form
   * judgement, so the two arms can be gated differently but scored identically —
   * which is the only way the comparison means anything.
   */
  accepted?: boolean;
};

export type Lead = {
  id: string;
  productId: string;
  runId: string;
  identityKey: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  profileUrl: string | null;
  company: string | null;
  signal: string;
  relevance: number;
  criteriaMet: CriterionAnswer[];
  evidence: Record<string, unknown>;
  outcome: string;
  createdAt: string;
};

// --- skills ---------------------------------------------------------------

export type SkillKind = "research" | "outreach";

export type Skill = {
  id: string;
  productId: string | null;
  slug: string;
  name: string;
  kind: SkillKind;
  instructions: string;
  toolAllowlist: string[];
};

// --- outreach -------------------------------------------------------------

export const AngleSchema = z.object({
  type: z.string(),
  reason: z.string(),
  benefit: z.string(),
});
export type Angle = z.infer<typeof AngleSchema>;

export const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const CritiqueSchema = z.object({
  pass: z.boolean(),
  usesDomainLanguage: z.boolean(),
  referencesSignal: z.boolean(),
  matchesToneAndLength: z.boolean(),
  fixes: z.array(z.string()),
});
export type Critique = z.infer<typeof CritiqueSchema>;

// --- run events -----------------------------------------------------------

export type RunEventKind =
  | "node_start"
  | "node_end"
  | "candidate"
  | "lead"
  | "progress"
  | "reasoning"
  | "done"
  | "error";

export type RunEvent = {
  id: number;
  runId: string;
  seq: number;
  kind: RunEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const RELEVANCE_THRESHOLD = 0.6;
