import { query, queryOne } from "@/lib/db/client";
import type {
  Criterion,
  CriterionAnswer,
  Disqualifier,
  DomainKnowledge,
  DomainTerm,
  ExampleEmail,
  Icp,
  Lead,
  ProductDefinition,
  ProductProfile,
  Skill,
  SkillKind,
} from "@/lib/types";

// --- products -------------------------------------------------------------

export type Product = {
  id: string;
  name: string;
  websiteUrl: string | null;
  createdAt: string;
};

type ProductRow = { id: string; name: string; website_url: string | null; created_at: Date };

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  websiteUrl: row.website_url,
  createdAt: row.created_at.toISOString(),
});

export async function createProduct(name: string, websiteUrl?: string): Promise<Product> {
  const row = await queryOne<ProductRow>(
    `insert into products (name, website_url) values ($1, $2)
     returning id, name, website_url, created_at`,
    [name, websiteUrl ?? null]
  );
  return toProduct(row!);
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const row = await queryOne<ProductRow>(
    `select id, name, website_url, created_at from products where id = $1`,
    [id]
  );
  return row ? toProduct(row) : undefined;
}

/** Products with just enough status to pick one from a list. */
export type ProductWithStatus = Product & {
  profileVersion: number | null;
  leadCount: number;
};

export async function listProductsWithStatus(): Promise<ProductWithStatus[]> {
  const rows = await query<
    ProductRow & { profile_version: number | null; lead_count: string }
  >(
    `select p.id, p.name, p.website_url, p.created_at,
       (select max(version) from product_profiles pp where pp.product_id = p.id) as profile_version,
       (select count(*) from leads l where l.product_id = p.id) as lead_count
     from products p
     order by p.created_at desc
     limit 100`
  );
  return rows.map((row) => ({
    ...toProduct(row),
    profileVersion: row.profile_version,
    leadCount: Number(row.lead_count),
  }));
}

export async function listProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>(
    `select id, name, website_url, created_at from products order by created_at desc limit 100`
  );
  return rows.map(toProduct);
}

// --- sources --------------------------------------------------------------

export type Source = {
  id: string;
  productId: string;
  kind: "website" | "pdf" | "link";
  uri: string | null;
  bucket: string | null;
  objectKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  rawText: string | null;
  checksum: string | null;
  status: "pending" | "ready" | "failed";
  error: string | null;
  createdAt: string;
};

type SourceRow = {
  id: string;
  product_id: string;
  kind: Source["kind"];
  uri: string | null;
  bucket: string | null;
  object_key: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  raw_text: string | null;
  checksum: string | null;
  status: Source["status"];
  error: string | null;
  created_at: Date;
};

const toSource = (row: SourceRow): Source => ({
  id: row.id,
  productId: row.product_id,
  kind: row.kind,
  uri: row.uri,
  bucket: row.bucket,
  objectKey: row.object_key,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
  rawText: row.raw_text,
  checksum: row.checksum,
  status: row.status,
  error: row.error,
  createdAt: row.created_at.toISOString(),
});

const SOURCE_COLUMNS = `id, product_id, kind, uri, bucket, object_key, mime_type,
  size_bytes, raw_text, checksum, status, error, created_at`;

export async function insertSource(input: {
  productId: string;
  kind: Source["kind"];
  uri?: string;
  bucket?: string;
  objectKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  status?: Source["status"];
}): Promise<Source> {
  const row = await queryOne<SourceRow>(
    `insert into sources (product_id, kind, uri, bucket, object_key, mime_type, size_bytes, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${SOURCE_COLUMNS}`,
    [
      input.productId,
      input.kind,
      input.uri ?? null,
      input.bucket ?? null,
      input.objectKey ?? null,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      input.status ?? "pending",
    ]
  );
  return toSource(row!);
}

export async function getSource(id: string): Promise<Source | undefined> {
  const row = await queryOne<SourceRow>(`select ${SOURCE_COLUMNS} from sources where id = $1`, [id]);
  return row ? toSource(row) : undefined;
}

export async function listSources(productId: string): Promise<Source[]> {
  const rows = await query<SourceRow>(
    `select ${SOURCE_COLUMNS} from sources where product_id = $1 order by created_at asc`,
    [productId]
  );
  return rows.map(toSource);
}

export async function updateSourceText(
  id: string,
  input: { rawText?: string; checksum?: string; status: Source["status"]; error?: string; sizeBytes?: number }
): Promise<void> {
  await query(
    `update sources set raw_text = coalesce($2, raw_text), checksum = coalesce($3, checksum),
       status = $4, error = $5, size_bytes = coalesce($6, size_bytes)
     where id = $1`,
    [id, input.rawText ?? null, input.checksum ?? null, input.status, input.error ?? null, input.sizeBytes ?? null]
  );
}

// --- profiles -------------------------------------------------------------

type ProfileRow = {
  id: string;
  product_id: string;
  version: number;
  product_definition: ProductDefinition;
  icp: Icp;
  domain_knowledge: DomainKnowledge;
  domain_language: { terms: DomainTerm[] };
  disqualifiers: Disqualifier[];
  scoring_criteria: Criterion[];
  example_emails: ExampleEmail[];
  created_at: Date;
};

const PROFILE_COLUMNS = `id, product_id, version, product_definition, icp, domain_knowledge,
  domain_language, disqualifiers, scoring_criteria, example_emails, created_at`;

const toProfile = (row: ProfileRow): ProductProfile => ({
  id: row.id,
  productId: row.product_id,
  version: row.version,
  productDefinition: row.product_definition,
  icp: row.icp,
  domainKnowledge: row.domain_knowledge,
  domainLanguage: row.domain_language,
  disqualifiers: row.disqualifiers,
  scoringCriteria: row.scoring_criteria,
  exampleEmails: row.example_emails ?? [],
  createdAt: row.created_at.toISOString(),
});

export type ProfileInput = {
  productDefinition: ProductDefinition;
  icp: Icp;
  domainKnowledge: DomainKnowledge;
  domainLanguage: { terms: DomainTerm[] };
  disqualifiers: Disqualifier[];
  scoringCriteria: Criterion[];
  exampleEmails?: ExampleEmail[];
};

/** Every write is a new version. Edits never destroy history. */
export async function insertProfileVersion(
  productId: string,
  input: ProfileInput
): Promise<ProductProfile> {
  const row = await queryOne<ProfileRow>(
    `insert into product_profiles
       (product_id, version, product_definition, icp, domain_knowledge, domain_language,
        disqualifiers, scoring_criteria, example_emails)
     select $1, coalesce(max(version), 0) + 1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
            $6::jsonb, $7::jsonb, $8::jsonb
     from product_profiles where product_id = $1
     returning ${PROFILE_COLUMNS}`,
    [
      productId,
      JSON.stringify(input.productDefinition),
      JSON.stringify(input.icp),
      JSON.stringify(input.domainKnowledge),
      JSON.stringify(input.domainLanguage),
      JSON.stringify(input.disqualifiers),
      JSON.stringify(input.scoringCriteria),
      JSON.stringify(input.exampleEmails ?? []),
    ]
  );
  return toProfile(row!);
}

export async function getCurrentProfile(productId: string): Promise<ProductProfile | undefined> {
  const row = await queryOne<ProfileRow>(
    `select ${PROFILE_COLUMNS} from product_profiles
     where product_id = $1 order by version desc limit 1`,
    [productId]
  );
  return row ? toProfile(row) : undefined;
}

export async function getProfileById(id: string): Promise<ProductProfile | undefined> {
  const row = await queryOne<ProfileRow>(`select ${PROFILE_COLUMNS} from product_profiles where id = $1`, [id]);
  return row ? toProfile(row) : undefined;
}

export async function listProfileVersions(productId: string): Promise<ProductProfile[]> {
  const rows = await query<ProfileRow>(
    `select ${PROFILE_COLUMNS} from product_profiles where product_id = $1 order by version desc`,
    [productId]
  );
  return rows.map(toProfile);
}

// --- runs -----------------------------------------------------------------

/**
 * The four phases a run is worked through, in order. `phase` records the one
 * the user last had open, which is what makes reopening a run resume rather
 * than restart; how far a run is *allowed* to go is derived from its data.
 */
export const RUN_PHASES = ["research", "lead_review", "comms", "outreach"] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

export type ResearchRun = {
  id: string;
  productId: string;
  profileId: string | null;
  targetCount: number;
  status: "running" | "done" | "partial" | "failed";
  phase: RunPhase;
  foundCount: number;
  examinedCount: number;
  budgetCandidates: number;
  budgetSeconds: number;
  useProfile: boolean;
  skillIds: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type RunRow = {
  id: string;
  product_id: string;
  profile_id: string | null;
  target_count: number;
  status: ResearchRun["status"];
  phase: RunPhase;
  found_count: number;
  examined_count: number;
  budget_candidates: number;
  budget_seconds: number;
  use_profile: boolean;
  skill_ids: string[];
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
};

const RUN_COLUMNS = `id, product_id, profile_id, target_count, status, phase, found_count, examined_count,
  budget_candidates, budget_seconds, use_profile, skill_ids, error, started_at, finished_at`;

const toRun = (row: RunRow): ResearchRun => ({
  id: row.id,
  productId: row.product_id,
  profileId: row.profile_id,
  targetCount: row.target_count,
  status: row.status,
  phase: row.phase,
  foundCount: row.found_count,
  examinedCount: row.examined_count,
  budgetCandidates: row.budget_candidates,
  budgetSeconds: row.budget_seconds,
  useProfile: row.use_profile,
  skillIds: row.skill_ids ?? [],
  error: row.error,
  startedAt: row.started_at.toISOString(),
  finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
});

export async function createRun(input: {
  productId: string;
  profileId: string | null;
  targetCount: number;
  budgetCandidates: number;
  budgetSeconds: number;
  useProfile: boolean;
  skillIds: string[];
}): Promise<ResearchRun> {
  const row = await queryOne<RunRow>(
    `insert into research_runs
       (product_id, profile_id, target_count, budget_candidates, budget_seconds, use_profile, skill_ids)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${RUN_COLUMNS}`,
    [
      input.productId,
      input.profileId,
      input.targetCount,
      input.budgetCandidates,
      input.budgetSeconds,
      input.useProfile,
      input.skillIds,
    ]
  );
  return toRun(row!);
}

export async function getRun(id: string): Promise<ResearchRun | undefined> {
  const row = await queryOne<RunRow>(`select ${RUN_COLUMNS} from research_runs where id = $1`, [id]);
  return row ? toRun(row) : undefined;
}

export async function listRuns(productId: string): Promise<ResearchRun[]> {
  const rows = await query<RunRow>(
    `select ${RUN_COLUMNS} from research_runs where product_id = $1 order by started_at desc limit 50`,
    [productId]
  );
  return rows.map(toRun);
}

/**
 * A run plus the counts the runs list and the phase rail both need.
 *
 * The counts are what decide how far a run may be navigated — a run with no
 * leads has nothing to review, one with no drafts has nothing to send — so they
 * are fetched with the run rather than by loading every lead of every run.
 */
export type RunSummary = ResearchRun & {
  leadCount: number;
  messageCount: number;
  sentCount: number;
};

type RunSummaryRow = RunRow & {
  lead_count: string;
  message_count: string;
  sent_count: string;
};

export async function listRunSummaries(productId: string): Promise<RunSummary[]> {
  const rows = await query<RunSummaryRow>(
    `select ${RUN_COLUMNS},
       (select count(*) from leads l where l.run_id = r.id) as lead_count,
       (select count(*) from messages m
          join leads l on l.id = m.lead_id
         where l.run_id = r.id) as message_count,
       (select count(*) from messages m
          join leads l on l.id = m.lead_id
         where l.run_id = r.id and m.status = 'sent') as sent_count
     from research_runs r
     where r.product_id = $1
     order by r.started_at desc
     limit 50`,
    [productId]
  );
  return rows.map((row) => ({
    ...toRun(row),
    leadCount: Number(row.lead_count),
    messageCount: Number(row.message_count),
    sentCount: Number(row.sent_count),
  }));
}

/** Records where the user is in a run, so reopening it lands on the same screen. */
export async function setRunPhase(id: string, phase: RunPhase): Promise<void> {
  await query(`update research_runs set phase = $2 where id = $1`, [id, phase]);
}

export async function updateRunProgress(
  id: string,
  input: { foundCount: number; examinedCount: number }
): Promise<void> {
  await query(`update research_runs set found_count = $2, examined_count = $3 where id = $1`, [
    id,
    input.foundCount,
    input.examinedCount,
  ]);
}

export async function finishRun(
  id: string,
  status: ResearchRun["status"],
  error?: string
): Promise<void> {
  await query(
    `update research_runs set status = $2, error = $3, finished_at = now() where id = $1`,
    [id, status, error ?? null]
  );
}

/** Any run left 'running' by a process restart is not actually running. */
export async function failStaleRuns(): Promise<number> {
  const rows = await query<{ id: string }>(
    `update research_runs set status = 'failed', finished_at = now(),
       error = 'Run did not survive a server restart'
     where status = 'running' and started_at < now() - interval '1 hour'
     returning id`
  );
  return rows.length;
}

// --- candidates, leads, exclusions ----------------------------------------

export async function recordCandidate(input: {
  runId: string;
  productId: string;
  identityKey: string;
  sourceUrl?: string;
  raw?: unknown;
  score?: number;
  verdict: "qualified" | "below_threshold" | "disqualified" | "excluded" | "unresolved";
  reason?: string;
}): Promise<void> {
  await query(
    `insert into candidates (run_id, product_id, identity_key, source_url, raw, score, verdict, reason)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [
      input.runId,
      input.productId,
      input.identityKey,
      input.sourceUrl ?? null,
      JSON.stringify(input.raw ?? {}),
      input.score ?? null,
      input.verdict,
      input.reason ?? null,
    ]
  );
}

/** One indexed query answers "have we seen any of these people". */
export async function findSeenIdentityKeys(
  productId: string,
  identityKeys: string[]
): Promise<Map<string, string>> {
  if (identityKeys.length === 0) return new Map();
  const rows = await query<{ identity_key: string; source: string }>(
    `select identity_key, 'lead' as source from leads where product_id = $1 and identity_key = any($2::text[])
     union all
     select identity_key, 'exclusion' as source from exclusions where product_id = $1 and identity_key = any($2::text[])`,
    [productId, identityKeys]
  );
  return new Map(rows.map((row) => [row.identity_key, row.source]));
}

type LeadRow = {
  id: string;
  product_id: string;
  run_id: string;
  identity_key: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  profile_url: string | null;
  company: string | null;
  signal: string;
  relevance: string;
  criteria_met: CriterionAnswer[];
  evidence: Record<string, unknown>;
  outcome: string;
  created_at: Date;
};

const LEAD_COLUMNS = `id, product_id, run_id, identity_key, full_name, email, phone, profile_url,
  company, signal, relevance, criteria_met, evidence, outcome, created_at`;

const toLead = (row: LeadRow): Lead => ({
  id: row.id,
  productId: row.product_id,
  runId: row.run_id,
  identityKey: row.identity_key,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  profileUrl: row.profile_url,
  company: row.company,
  signal: row.signal,
  relevance: Number(row.relevance),
  criteriaMet: row.criteria_met,
  evidence: row.evidence,
  outcome: row.outcome,
  createdAt: row.created_at.toISOString(),
});

export async function insertLead(input: {
  productId: string;
  runId: string;
  identityKey: string;
  fullName: string;
  email?: string;
  phone?: string;
  profileUrl?: string;
  company?: string;
  signal: string;
  relevance: number;
  criteriaMet: CriterionAnswer[];
  evidence?: Record<string, unknown>;
}): Promise<Lead | undefined> {
  const row = await queryOne<LeadRow>(
    `insert into leads (product_id, run_id, identity_key, full_name, email, phone, profile_url,
       company, signal, relevance, criteria_met, evidence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
     on conflict (product_id, identity_key) do nothing
     returning ${LEAD_COLUMNS}`,
    [
      input.productId,
      input.runId,
      input.identityKey,
      input.fullName,
      input.email ?? null,
      input.phone ?? null,
      input.profileUrl ?? null,
      input.company ?? null,
      input.signal,
      input.relevance,
      JSON.stringify(input.criteriaMet),
      JSON.stringify(input.evidence ?? {}),
    ]
  );
  return row ? toLead(row) : undefined;
}

export async function listLeadsForRun(runId: string): Promise<Lead[]> {
  const rows = await query<LeadRow>(
    `select ${LEAD_COLUMNS} from leads where run_id = $1 order by relevance desc, created_at asc`,
    [runId]
  );
  return rows.map(toLead);
}

export async function listLeadsForProduct(productId: string): Promise<Lead[]> {
  const rows = await query<LeadRow>(
    `select ${LEAD_COLUMNS} from leads where product_id = $1 order by created_at desc limit 500`,
    [productId]
  );
  return rows.map(toLead);
}

export async function getLead(id: string): Promise<Lead | undefined> {
  const row = await queryOne<LeadRow>(`select ${LEAD_COLUMNS} from leads where id = $1`, [id]);
  return row ? toLead(row) : undefined;
}

export async function setLeadOutcome(id: string, outcome: string): Promise<void> {
  await query(`update leads set outcome = $2 where id = $1`, [id, outcome]);
}

export async function addExclusion(
  productId: string,
  identityKey: string,
  reason?: string
): Promise<void> {
  await query(
    `insert into exclusions (product_id, identity_key, reason) values ($1, $2, $3)
     on conflict (product_id, identity_key) do nothing`,
    [productId, identityKey, reason ?? null]
  );
}

export async function recordBillingEvent(input: {
  productId: string;
  runId?: string;
  kind: "lead_found" | "profile_generated";
  quantity?: number;
}): Promise<void> {
  await query(
    `insert into billing_events (product_id, run_id, kind, quantity) values ($1, $2, $3, $4)`,
    [input.productId, input.runId ?? null, input.kind, input.quantity ?? 1]
  );
}

// --- skills ---------------------------------------------------------------

type SkillRow = {
  id: string;
  product_id: string | null;
  slug: string;
  name: string;
  kinds: SkillKind[];
  instructions: string;
  tool_allowlist: string[];
};

const toSkill = (row: SkillRow): Skill => ({
  id: row.id,
  productId: row.product_id,
  slug: row.slug,
  name: row.name,
  kinds: row.kinds ?? [],
  instructions: row.instructions,
  toolAllowlist: row.tool_allowlist ?? [],
});

export async function listSkills(kind?: SkillKind, productId?: string): Promise<Skill[]> {
  const rows = await query<SkillRow>(
    `select id, product_id, slug, name, kinds, instructions, tool_allowlist
     from skills
     where (product_id is null or product_id = $1)
       and ($2::text is null or $2::text = any(kinds))
     order by name`,
    [productId ?? null, kind ?? null]
  );
  return rows.map(toSkill);
}

export async function getSkillsByIds(ids: string[]): Promise<Skill[]> {
  if (ids.length === 0) return [];
  const rows = await query<SkillRow>(
    `select id, product_id, slug, name, kinds, instructions, tool_allowlist
     from skills where id = any($1::uuid[])`,
    [ids]
  );
  return rows.map(toSkill);
}

/** A skill plus the name of the product it belongs to, for the manage screen. */
export type SkillWithProduct = Skill & { productName: string | null };

/**
 * Every skill in the system, global and product-scoped alike. The flow's own
 * picker filters by product; this is the library view, where seeing that a
 * skill belongs to another product is the point.
 */
export async function listAllSkills(): Promise<SkillWithProduct[]> {
  const rows = await query<SkillRow & { product_name: string | null }>(
    `select s.id, s.product_id, s.slug, s.name, s.kinds, s.instructions, s.tool_allowlist,
            p.name as product_name
     from skills s
     left join products p on p.id = s.product_id
     order by s.name`
  );
  return rows.map((row) => ({ ...toSkill(row), productName: row.product_name }));
}

export async function getSkill(id: string): Promise<Skill | undefined> {
  const row = await queryOne<SkillRow>(
    `select id, product_id, slug, name, kinds, instructions, tool_allowlist
     from skills where id = $1`,
    [id]
  );
  return row ? toSkill(row) : undefined;
}

/** Slugs of the shipped defaults that have already been planted at least once. */
export async function seededSkillSlugs(): Promise<Set<string>> {
  const rows = await query<{ slug: string }>(`select slug from seeded_skills`);
  return new Set(rows.map((row) => row.slug));
}

export async function markSkillSeeded(slug: string): Promise<void> {
  await query(`insert into seeded_skills (slug) values ($1) on conflict (slug) do nothing`, [slug]);
}

/**
 * Plants a shipped default, once. `do nothing` rather than `do update` so a
 * global skill the user has since renamed or rewritten is left alone.
 */
export async function insertDefaultSkill(input: {
  slug: string;
  name: string;
  kinds: SkillKind[];
  instructions: string;
  toolAllowlist: string[];
}): Promise<void> {
  await query(
    `insert into skills (product_id, slug, name, kinds, instructions, tool_allowlist)
     values (null, $1, $2, $3, $4, $5)
     on conflict (slug) where product_id is null do nothing`,
    [input.slug, input.name, input.kinds, input.instructions, input.toolAllowlist]
  );
}

export async function createSkill(input: {
  productId: string | null;
  slug: string;
  name: string;
  kinds: SkillKind[];
  instructions: string;
  toolAllowlist: string[];
}): Promise<Skill> {
  const row = await queryOne<SkillRow>(
    `insert into skills (product_id, slug, name, kinds, instructions, tool_allowlist)
     values ($1, $2, $3, $4, $5, $6)
     returning id, product_id, slug, name, kinds, instructions, tool_allowlist`,
    [
      input.productId,
      input.slug,
      input.name,
      input.kinds,
      input.instructions,
      input.toolAllowlist,
    ]
  );
  return toSkill(row!);
}

/** Partial update: anything left undefined keeps its current value. */
export async function updateSkill(
  id: string,
  patch: {
    slug?: string;
    name?: string;
    kinds?: SkillKind[];
    instructions?: string;
    toolAllowlist?: string[];
  }
): Promise<Skill | undefined> {
  const row = await queryOne<SkillRow>(
    `update skills set
       slug           = coalesce($2::text, slug),
       name           = coalesce($3::text, name),
       kinds          = coalesce($4::text[], kinds),
       instructions   = coalesce($5::text, instructions),
       tool_allowlist = coalesce($6::text[], tool_allowlist)
     where id = $1
     returning id, product_id, slug, name, kinds, instructions, tool_allowlist`,
    [
      id,
      patch.slug ?? null,
      patch.name ?? null,
      patch.kinds ?? null,
      patch.instructions ?? null,
      patch.toolAllowlist ?? null,
    ]
  );
  return row ? toSkill(row) : undefined;
}

/**
 * Hard delete. Past runs keep the skill id in `research_runs.skill_ids`, which
 * is an id list rather than a foreign key, so history stays readable even
 * though the skill itself is gone.
 */
export async function deleteSkill(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(`delete from skills where id = $1 returning id`, [id]);
  return Boolean(row);
}

// --- messages -------------------------------------------------------------

export type Message = {
  id: string;
  leadId: string;
  threadId: string;
  subject: string;
  body: string;
  angle: { type: string; reason: string; benefit: string };
  critique: unknown;
  status: "draft" | "approved" | "sent" | "failed";
  gmailMessageId: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
};

type MessageRow = {
  id: string;
  lead_id: string;
  thread_id: string;
  subject: string;
  body: string;
  angle: Message["angle"];
  critique: unknown;
  status: Message["status"];
  gmail_message_id: string | null;
  error: string | null;
  sent_at: Date | null;
  created_at: Date;
};

const MESSAGE_COLUMNS = `id, lead_id, thread_id, subject, body, angle, critique, status,
  gmail_message_id, error, sent_at, created_at`;

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  leadId: row.lead_id,
  threadId: row.thread_id,
  subject: row.subject,
  body: row.body,
  angle: row.angle,
  critique: row.critique,
  status: row.status,
  gmailMessageId: row.gmail_message_id,
  error: row.error,
  sentAt: row.sent_at ? row.sent_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

export async function insertMessage(input: {
  leadId: string;
  threadId: string;
  subject: string;
  body: string;
  angle: Message["angle"];
  critique?: unknown;
}): Promise<Message> {
  const row = await queryOne<MessageRow>(
    `insert into messages (lead_id, thread_id, subject, body, angle, critique)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     returning ${MESSAGE_COLUMNS}`,
    [
      input.leadId,
      input.threadId,
      input.subject,
      input.body,
      JSON.stringify(input.angle),
      JSON.stringify(input.critique ?? null),
    ]
  );
  return toMessage(row!);
}

/**
 * LangGraph re-executes an interrupted node from the top when it resumes, so the
 * draft insert has to be idempotent or every approval would double the row.
 * One draft per graph thread is the invariant.
 */
export async function upsertDraftMessage(input: {
  leadId: string;
  threadId: string;
  subject: string;
  body: string;
  angle: Message["angle"];
  critique?: unknown;
}): Promise<Message> {
  const existing = await queryOne<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages
     where thread_id = $1 and status in ('draft', 'approved')
     order by created_at desc limit 1`,
    [input.threadId]
  );
  if (existing) {
    const updated = await queryOne<MessageRow>(
      `update messages set subject = $2, body = $3, angle = $4::jsonb, critique = $5::jsonb
       where id = $1 returning ${MESSAGE_COLUMNS}`,
      [
        existing.id,
        input.subject,
        input.body,
        JSON.stringify(input.angle),
        JSON.stringify(input.critique ?? null),
      ]
    );
    return toMessage(updated!);
  }
  return insertMessage(input);
}

export async function getMessage(id: string): Promise<Message | undefined> {
  const row = await queryOne<MessageRow>(`select ${MESSAGE_COLUMNS} from messages where id = $1`, [id]);
  return row ? toMessage(row) : undefined;
}

export async function listMessagesForLeads(leadIds: string[]): Promise<Message[]> {
  if (leadIds.length === 0) return [];
  const rows = await query<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages where lead_id = any($1::uuid[]) order by created_at desc`,
    [leadIds]
  );
  return rows.map(toMessage);
}

export async function updateMessage(
  id: string,
  input: Partial<{
    subject: string;
    body: string;
    status: Message["status"];
    gmailMessageId: string;
    error: string | null;
    sentAt: boolean;
  }>
): Promise<Message | undefined> {
  const row = await queryOne<MessageRow>(
    `update messages set
       subject = coalesce($2, subject),
       body = coalesce($3, body),
       status = coalesce($4, status),
       gmail_message_id = coalesce($5, gmail_message_id),
       error = $6,
       sent_at = case when $7 then now() else sent_at end
     where id = $1
     returning ${MESSAGE_COLUMNS}`,
    [
      id,
      input.subject ?? null,
      input.body ?? null,
      input.status ?? null,
      input.gmailMessageId ?? null,
      input.error ?? null,
      input.sentAt ?? false,
    ]
  );
  return row ? toMessage(row) : undefined;
}

export async function productIdForMessage(messageId: string): Promise<string | undefined> {
  const row = await queryOne<{ product_id: string }>(
    `select l.product_id from messages m join leads l on l.id = m.lead_id where m.id = $1`,
    [messageId]
  );
  return row?.product_id;
}
