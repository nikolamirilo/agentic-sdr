import type { RawCandidate } from "@/lib/types";

/**
 * One rule, applied everywhere:
 *   Exa answers "who or what exists that matches this."
 *   Firecrawl answers "what does this specific page actually say."
 *
 * Both sit behind interfaces, because both will rate limit you at the worst
 * moment and you want the swap to be one file.
 */

export type JsonSchemaLike = Record<string, unknown>;

export interface DiscoveryProvider {
  readonly name: string;
  search(
    q: string,
    opts: { limit: number; type?: "company" | "person"; excludeDomains?: string[] }
  ): Promise<RawCandidate[]>;
  findSimilar(url: string, opts: { limit: number }): Promise<RawCandidate[]>;
}

export interface ExtractionProvider {
  readonly name: string;
  map(domain: string, opts?: { limit?: number; search?: string }): Promise<string[]>;
  scrape<T>(
    url: string,
    schema: unknown,
    opts?: { prompt?: string }
  ): Promise<{ json: T | undefined; markdown: string; url: string }>;
  scrapeText(url: string): Promise<{ markdown: string; url: string; title?: string }>;
}

export type EnrichmentResult = {
  email?: string;
  phone?: string;
  fullName?: string;
  role?: string;
  company?: string;
  companyDomain?: string;
  profileUrl?: string;
  confidence?: number;
  provider: string;
};

export interface EnrichmentProvider {
  readonly name: string;
  /** True when this provider can return a real email, not just company detail. */
  readonly resolvesContacts: boolean;
  /**
   * Contact details for a candidate. Returns undefined when nothing is found.
   * `context.markdown` is the already-scraped page, passed in so the fallback
   * provider does not pay for a second scrape.
   */
  enrich(
    candidate: RawCandidate,
    context?: { markdown?: string }
  ): Promise<EnrichmentResult | undefined>;
}

// --- linkedin -------------------------------------------------------------

/**
 * Up2Data answers "who holds this role at this kind of company". Structured
 * filters, not a query string: LinkedIn's own facets are the search surface,
 * and free text only exists for titles and keywords.
 */

/** Geo, industry and school facets take LinkedIn numeric ids, which v1 has no
 * typeahead for — so this exposes the facets that take free text or fixed
 * enums, plus company ids resolved from a company lookup. */
export type PeopleSearchFilters = {
  titles?: string[];
  past_titles?: string[];
  /** owner | partner | cxo | vp | director | manager | senior | entry | training | strategic */
  seniorities?: string[];
  /** self-employed | 1-10 | 11-50 | 51-200 | 201-500 | 501-1000 | 1001-5000 | 5001-10000 | 10001+ */
  company_sizes?: string[];
  /** LinkedIn organization ids, from `enrichCompany`. */
  company_ids?: string[];
  past_company_ids?: string[];
  keywords?: string;
  first_name?: string;
  last_name?: string;
};

export type CompanySearchFilters = {
  keywords?: string;
  company_sizes?: string[];
  /** public | educational | government | nonprofit | private | self_employed | self_owned */
  company_types?: string[];
};

export type LinkedInCompany = {
  name?: string;
  url?: string;
  linkedinId?: string;
  website?: string;
  /** The website host, which is the domain everything else in this app keys on. */
  domain?: string;
  description?: string;
  industry?: string;
  headcount?: number;
  headcountGrowth6m?: number;
  sizeBracket?: string;
  founded?: number;
  hq?: string;
  specialties: string[];
  fundingTotalUsd?: number;
  lastRound?: { type?: string; amountUsd?: number; date?: string };
  scrapedAt?: string;
};

export type LinkedInProfile = {
  url: string;
  fullName?: string;
  headline?: string;
  location?: string;
  role?: string;
  company?: string;
  companyLinkedInId?: string;
  companyUrl?: string;
  startedAt?: string;
  positions: Array<{
    title?: string;
    company?: string;
    startedAt?: string;
    endedAt?: string;
    description?: string;
  }>;
  education: Array<{ school?: string; degree?: string; field?: string }>;
  skills: string[];
  followersCount?: number;
  scrapedAt?: string;
};

export interface LinkedInProvider {
  readonly name: string;
  /** Profile stubs matching the filters. Billed per page of 25. */
  searchPeople(filters: PeopleSearchFilters, opts?: { maxResults?: number }): Promise<RawCandidate[]>;
  /** Company stubs matching the filters. Billed per page of 25. */
  searchCompanies(filters: CompanySearchFilters, opts?: { maxResults?: number }): Promise<RawCandidate[]>;
  /** Live firmographics from a website domain, LinkedIn URL or organization id. */
  enrichCompany(target: { url?: string; domain?: string; linkedinId?: string }): Promise<LinkedInCompany | undefined>;
  /** The full member record. The one way to read a page Firecrawl cannot. */
  enrichProfile(url: string): Promise<LinkedInProfile | undefined>;
}
