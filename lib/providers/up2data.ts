import { env } from "@/lib/env";
import type {
  LinkedInCompany,
  LinkedInProfile,
  LinkedInProvider,
  CompanySearchFilters,
  PeopleSearchFilters,
} from "@/lib/providers/types";
import type { RawCandidate } from "@/lib/types";
import { pLimit, resilient } from "@/lib/providers/resilience";
import { cached } from "@/lib/providers/cache";
import { normalizeDomain } from "@/lib/identity";

/**
 * Up2Data answers "who works where, right now".
 *
 * The third rule alongside the other two providers:
 *   Exa answers "who or what exists that matches this".
 *   Firecrawl answers "what does this specific page actually say".
 *   Up2Data answers "who holds this role at this kind of company".
 *
 * It is the only source here that sees inside LinkedIn, which is where the
 * title, the tenure and the current headcount actually live. Everything is a
 * live scrape: no cache on their side, 15-20s per call in practice, and billed
 * per success — so every call goes through the local cache and a tight
 * concurrency cap, and nothing is called speculatively.
 *
 * Docs: https://docs.up2data.ai
 */

const BASE_URL = "https://api.up2data.ai/v1";

/**
 * Their own numbers are 2-8s; observed is 15-20s for search and enrich, because
 * a live LinkedIn scrape sits behind every call. The 20s default would time out
 * on a call that was about to succeed — and a timed-out call we retry is a call
 * we may pay for twice.
 */
const SEARCH_TIMEOUT_MS = 75_000;
const ENRICH_TIMEOUT_MS = 45_000;

/** Process-wide, for the same reason as Firecrawl's. 300 req/min on Standard. */
const limit = pLimit(Number(process.env.UP2DATA_CONCURRENCY ?? 3));

export class Up2DataError extends Error {
  constructor(
    readonly type: string,
    message: string,
    readonly status: number,
    readonly requestId?: string
  ) {
    super(`up2data ${status} ${type}: ${message}`);
    this.name = "Up2DataError";
  }
}

/**
 * 429/500/504 are the vendor's own retryable set and are never billed. A 400,
 * 401, 402 or 422 will fail identically on every attempt, so burning the
 * remaining attempts on one only delays the run.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function retryOn(error: unknown): boolean {
  if (error instanceof Up2DataError) return RETRYABLE_STATUS.has(error.status);
  return true; // timeouts and transport failures
}

type Envelope<T> = {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { type?: string; message?: string; requestId?: string };
};

function apiKey(): string {
  if (!env.up2dataApiKey) throw new Error("UP2DATA_API_KEY is not set");
  return env.up2dataApiKey;
}

/**
 * Returns undefined rather than throwing when the target simply is not there
 * (private profile, deleted company, no matches). Those are outcomes, not
 * failures — and per pay-on-success they cost nothing. One missing profile must
 * never stop a run.
 */
async function post<T>(path: string, body: unknown, label: string, timeoutMs: number): Promise<T | undefined> {
  return limit(() =>
    resilient({ label, timeoutMs, retryOn }, async (signal) => {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey() },
        body: JSON.stringify(body),
        signal,
      });

      const envelope = (await response.json().catch(() => ({}))) as Envelope<T>;

      if (!response.ok) {
        const type = envelope.error?.type ?? "http_error";
        if (response.status === 404 || response.status === 422) return undefined;
        throw new Up2DataError(
          type,
          envelope.error?.message ?? response.statusText,
          response.status,
          envelope.error?.requestId
        );
      }
      return envelope.data;
    })
  );
}

// --- response shapes ------------------------------------------------------
// Written against what the API actually returns, which is a subset of the
// documented schema on most records: a profile with no listed skills has no
// `skills` key at all. Everything optional, nothing assumed.

type PersonPosition = {
  title?: string;
  company?: string;
  company_url?: string;
  linkedin_id?: string;
  started_at?: string;
  ended_at?: string | null;
  description?: string;
};

type PersonResult = {
  url?: string;
  public_identifier?: string;
  urn?: string;
  full_name?: string;
  headline?: string;
  location?: { city?: string; region?: string; country?: string };
  current_company?: { name?: string; url?: string; linkedin_id?: string; title?: string; started_at?: string };
  positions?: PersonPosition[];
  education?: Array<{ school?: string; degree?: string; field?: string }>;
  skills?: string[];
  languages?: string[];
  followers_count?: number;
  connections_count?: number;
  scraped_at?: string;
};

type CompanyResult = {
  url?: string;
  name?: string;
  linkedin_id?: string;
  website?: string;
  description?: string;
  industry?: string;
  headcount?: number;
  headcount_growth_6m?: number;
  company_size?: { min?: number; max?: number };
  founded?: number;
  hq?: { city?: string; region?: string; country?: string };
  specialties?: string[];
  funding?: { total_usd?: number; last_round?: { type?: string; amount_usd?: number; date?: string } };
  followers_count?: number;
  scraped_at?: string;
};

type SearchResponse<T> = {
  results?: T[];
  pagination?: { returned?: number; max_results?: number; pages_scraped?: number; has_more?: boolean };
};

// --- mapping --------------------------------------------------------------

function placeOf(location?: { city?: string; region?: string; country?: string }): string | undefined {
  const parts = [location?.city, location?.region, location?.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function currentRole(person: PersonResult): PersonPosition | undefined {
  return person.positions?.find((p) => !p.ended_at) ?? person.positions?.[0];
}

export function toCompany(company: CompanyResult): LinkedInCompany {
  return {
    name: company.name,
    url: company.url,
    linkedinId: company.linkedin_id,
    website: company.website,
    domain: normalizeDomain(company.website),
    description: company.description,
    industry: company.industry,
    headcount: company.headcount,
    headcountGrowth6m: company.headcount_growth_6m,
    sizeBracket:
      company.company_size?.min !== undefined
        ? `${company.company_size.min}-${company.company_size.max ?? "+"}`
        : undefined,
    founded: company.founded,
    hq: placeOf(company.hq),
    specialties: company.specialties ?? [],
    fundingTotalUsd: company.funding?.total_usd,
    lastRound: company.funding?.last_round
      ? {
          type: company.funding.last_round.type,
          amountUsd: company.funding.last_round.amount_usd,
          date: company.funding.last_round.date,
        }
      : undefined,
    scrapedAt: company.scraped_at,
  };
}

export function toProfile(person: PersonResult): LinkedInProfile {
  const role = currentRole(person);
  return {
    url: person.url ?? "",
    fullName: person.full_name,
    headline: person.headline,
    location: placeOf(person.location),
    role: person.current_company?.title ?? role?.title,
    company: person.current_company?.name ?? role?.company,
    companyLinkedInId: person.current_company?.linkedin_id ?? role?.linkedin_id,
    companyUrl: person.current_company?.url ?? role?.company_url,
    startedAt: person.current_company?.started_at ?? role?.started_at,
    positions: (person.positions ?? []).map((p) => ({
      title: p.title,
      company: p.company,
      startedAt: p.started_at,
      endedAt: p.ended_at ?? undefined,
      description: p.description,
    })),
    education: (person.education ?? []).map((e) => ({ school: e.school, degree: e.degree, field: e.field })),
    skills: person.skills ?? [],
    followersCount: person.followers_count,
    scrapedAt: person.scraped_at,
  };
}

/**
 * A person becomes a candidate. `companyDomain` is deliberately left empty:
 * LinkedIn search does not carry the company website, and filling it with
 * linkedin.com would corrupt both identity and contact lookup downstream.
 * The company's LinkedIn id rides along in evidence so enrich can resolve the
 * real domain in one call.
 */
function personToCandidate(person: PersonResult, query: string): RawCandidate {
  const profile = toProfile(person);
  const tenure = profile.startedAt ? ` since ${profile.startedAt}` : "";

  return {
    fullName: profile.fullName,
    company: profile.company,
    role: profile.role,
    profileUrl: profile.url,
    sourceUrl: profile.url,
    title: profile.headline ?? [profile.role, profile.company].filter(Boolean).join(" at "),
    snippet: [
      profile.headline,
      profile.role && profile.company ? `${profile.role} at ${profile.company}${tenure}.` : undefined,
      profile.location ? `Based in ${profile.location}.` : undefined,
      profile.positions[0]?.description,
    ]
      .filter(Boolean)
      .join(" "),
    signal: profile.role && profile.company ? `${profile.role} at ${profile.company}${tenure}` : undefined,
    evidence: {
      source: "up2data.searchPeople",
      linkedinProfileUrl: profile.url,
      companyLinkedInId: profile.companyLinkedInId,
      companyLinkedInUrl: profile.companyUrl,
      location: profile.location,
      roleStartedAt: profile.startedAt,
      positions: profile.positions.slice(0, 3),
    },
    query,
  };
}

function companyToCandidate(company: CompanyResult, query: string): RawCandidate {
  const mapped = toCompany(company);
  return {
    company: mapped.name,
    companyDomain: mapped.domain,
    sourceUrl: mapped.website ?? mapped.url ?? "",
    title: mapped.name,
    snippet: [
      mapped.description,
      mapped.industry ? `Industry: ${mapped.industry}.` : undefined,
      mapped.headcount ? `${mapped.headcount} employees on LinkedIn.` : undefined,
      mapped.hq ? `HQ ${mapped.hq}.` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    evidence: {
      source: "up2data.searchCompanies",
      companyLinkedInId: mapped.linkedinId,
      companyLinkedInUrl: mapped.url,
      headcount: mapped.headcount,
      industry: mapped.industry,
      hq: mapped.hq,
    },
    query,
  };
}

/** Human-readable summary of the filters, for run events and cache keys. */
export function describeFilters(filters: PeopleSearchFilters | CompanySearchFilters): string {
  const parts: string[] = [];
  if ("titles" in filters && filters.titles?.length) parts.push(filters.titles.join(" / "));
  if ("seniorities" in filters && filters.seniorities?.length) parts.push(filters.seniorities.join(" / "));
  if (filters.keywords) parts.push(`"${filters.keywords}"`);
  if (filters.company_sizes?.length) parts.push(`${filters.company_sizes.join(", ")} employees`);
  if ("company_ids" in filters && filters.company_ids?.length) parts.push(`${filters.company_ids.length} companies`);
  return parts.join(" · ") || "no filters";
}

export function hasFilters(filters: PeopleSearchFilters | CompanySearchFilters | undefined): boolean {
  if (!filters) return false;
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : false
  );
}

export class Up2DataLinkedInProvider implements LinkedInProvider {
  readonly name = "up2data";

  constructor(private readonly productId?: string) {}

  async searchPeople(
    filters: PeopleSearchFilters,
    opts: { maxResults?: number } = {}
  ): Promise<RawCandidate[]> {
    if (!hasFilters(filters)) return [];
    // 1 credit per page of 25, so ask for whole pages and no more than needed.
    const maxResults = Math.min(Math.max(opts.maxResults ?? 25, 1), 1000);
    const label = describeFilters(filters);

    const results = await cached(this.productId, ["up2data.searchPeople", filters, maxResults], () =>
      post<SearchResponse<PersonResult>>(
        "/search/people",
        { filters, max_results: maxResults },
        `up2data.searchPeople(${label.slice(0, 40)})`,
        SEARCH_TIMEOUT_MS
      )
    );

    return (results?.results ?? [])
      .filter((person) => Boolean(person.url))
      .map((person) => personToCandidate(person, `linkedin:${label}`));
  }

  async searchCompanies(
    filters: CompanySearchFilters,
    opts: { maxResults?: number } = {}
  ): Promise<RawCandidate[]> {
    if (!hasFilters(filters)) return [];
    const maxResults = Math.min(Math.max(opts.maxResults ?? 25, 1), 1000);
    const label = describeFilters(filters);

    const results = await cached(this.productId, ["up2data.searchCompanies", filters, maxResults], () =>
      post<SearchResponse<CompanyResult>>(
        "/search/companies",
        { filters, max_results: maxResults },
        `up2data.searchCompanies(${label.slice(0, 40)})`,
        SEARCH_TIMEOUT_MS
      )
    );

    return (results?.results ?? [])
      .map((company) => companyToCandidate(company, `linkedin:${label}`))
      .filter((candidate) => Boolean(candidate.sourceUrl));
  }

  /** One of url, domain or linkedinId identifies the company. Same cost either way. */
  async enrichCompany(
    target: { url?: string; domain?: string; linkedinId?: string }
  ): Promise<LinkedInCompany | undefined> {
    const body: Record<string, string> = {};
    if (target.linkedinId) body.linkedin_id = target.linkedinId;
    else if (target.url) body.url = target.url;
    else if (target.domain) body.domain = normalizeDomain(target.domain) ?? target.domain;
    else return undefined;

    const company = await cached(this.productId, ["up2data.enrichCompany", body], () =>
      post<CompanyResult>("/companies/enrich", body, `up2data.enrichCompany(${Object.values(body)[0]})`, ENRICH_TIMEOUT_MS)
    );
    return company ? toCompany(company) : undefined;
  }

  async enrichProfile(url: string): Promise<LinkedInProfile | undefined> {
    const person = await cached(this.productId, ["up2data.enrichProfile", url], () =>
      post<PersonResult>("/profiles/enrich", { url }, `up2data.enrichProfile(${url})`, ENRICH_TIMEOUT_MS)
    );
    return person ? toProfile(person) : undefined;
  }
}

export function linkedInProvider(productId?: string): LinkedInProvider {
  return new Up2DataLinkedInProvider(productId);
}

/** True for a LinkedIn member page — the pages Firecrawl cannot read. */
export function isLinkedInProfileUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(parsed.hostname) && /^\/in\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Flattens a profile into the evidence text the scoring node reads. */
export function renderProfileText(profile: LinkedInProfile): string {
  const lines = [
    profile.fullName ? `Name: ${profile.fullName}` : undefined,
    profile.headline ? `Headline: ${profile.headline}` : undefined,
    profile.role && profile.company
      ? `Current role: ${profile.role} at ${profile.company}${profile.startedAt ? ` (since ${profile.startedAt})` : ""}`
      : undefined,
    profile.location ? `Location: ${profile.location}` : undefined,
    profile.skills.length > 0 ? `Skills: ${profile.skills.slice(0, 20).join(", ")}` : undefined,
  ].filter(Boolean);

  if (profile.positions.length > 0) {
    lines.push("Experience:");
    for (const position of profile.positions.slice(0, 6)) {
      const span = [position.startedAt, position.endedAt ?? "present"].filter(Boolean).join(" – ");
      lines.push(`- ${position.title ?? "role"} at ${position.company ?? "unknown"}${span ? ` (${span})` : ""}`);
      if (position.description) lines.push(`  ${position.description.slice(0, 400)}`);
    }
  }

  if (profile.education.length > 0) {
    lines.push(
      `Education: ${profile.education
        .slice(0, 3)
        .map((e) => [e.school, e.degree].filter(Boolean).join(", "))
        .join("; ")}`
    );
  }

  return lines.join("\n");
}
