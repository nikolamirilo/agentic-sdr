import type { EnrichmentProvider, EnrichmentResult } from "@/lib/providers/types";
import type { RawCandidate } from "@/lib/types";
import { env, features } from "@/lib/env";
import { resilient } from "@/lib/providers/resilience";
import { normalizeDomain } from "@/lib/identity";

/**
 * Contact enrichment.
 *
 * Paid providers are the real answer here and the interface exists so one drops
 * in behind ENRICHMENT_API_URL. Without one the app does not pretend: it runs
 * company-level research and surfaces the contact as unresolved rather than
 * inventing an address. A fabricated email is worse than a missing one.
 */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Addresses that are never a person and should never become a lead's contact.
const ROLE_ADDRESS_RE =
  /^(info|support|hello|contact|sales|admin|help|press|careers|jobs|noreply|no-reply|privacy|legal|security|abuse)@/i;

// Domains that appear in page furniture rather than in the candidate's contact details.
const IGNORED_EMAIL_DOMAINS = new Set([
  "sentry.io",
  "example.com",
  "email.com",
  "domain.com",
  "wixpress.com",
  "squarespace.com",
]);

export function extractEmails(markdown: string, preferDomain?: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(EMAIL_RE)) {
    const email = match[0].toLowerCase();
    const domain = email.split("@")[1];
    if (IGNORED_EMAIL_DOMAINS.has(domain)) continue;
    if (domain.endsWith(".png") || domain.endsWith(".jpg") || domain.endsWith(".svg")) continue;
    found.add(email);
  }
  const all = [...found];
  const personal = all.filter((e) => !ROLE_ADDRESS_RE.test(e));
  const pool = personal.length > 0 ? personal : all;
  if (!preferDomain) return pool;
  const matching = pool.filter((e) => e.endsWith(`@${preferDomain}`));
  return matching.length > 0 ? matching : pool;
}

/**
 * Reads whatever contact detail is already on the page. Honest about what it
 * is: page-derived, not a verified enrichment record.
 */
export class PageDerivedEnrichmentProvider implements EnrichmentProvider {
  readonly name = "page-derived";
  readonly resolvesContacts = false;

  async enrich(
    candidate: RawCandidate,
    context?: { markdown?: string }
  ): Promise<EnrichmentResult | undefined> {
    const markdown = context?.markdown ?? candidate.snippet ?? "";
    if (!markdown) return undefined;
    const domain = normalizeDomain(candidate.companyDomain ?? candidate.sourceUrl);
    const [email] = extractEmails(markdown, domain);
    if (!email) return undefined;
    return {
      email,
      companyDomain: domain,
      confidence: ROLE_ADDRESS_RE.test(email) ? 0.3 : 0.6,
      provider: this.name,
    };
  }
}

/**
 * Generic HTTP enrichment client. Point ENRICHMENT_API_URL at a provider that
 * takes { fullName, company, domain, profileUrl } and returns { email, phone }.
 * Swapping vendors is a URL change, not a code change.
 */
export class HttpEnrichmentProvider implements EnrichmentProvider {
  readonly name = "http";
  readonly resolvesContacts = true;

  constructor(private readonly url: string, private readonly apiKey: string) {}

  async enrich(candidate: RawCandidate): Promise<EnrichmentResult | undefined> {
    const body = {
      fullName: candidate.fullName,
      company: candidate.company,
      domain: normalizeDomain(candidate.companyDomain ?? candidate.sourceUrl),
      profileUrl: candidate.profileUrl,
      role: candidate.role,
    };

    return resilient({ label: "enrichment.enrich" }, async (signal) => {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`enrichment ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      const email = typeof data.email === "string" ? data.email.toLowerCase() : undefined;
      if (!email && !data.phone) return undefined;
      return {
        email,
        phone: typeof data.phone === "string" ? data.phone : undefined,
        fullName: typeof data.fullName === "string" ? data.fullName : undefined,
        role: typeof data.role === "string" ? data.role : undefined,
        company: typeof data.company === "string" ? data.company : undefined,
        companyDomain: body.domain,
        confidence: typeof data.confidence === "number" ? data.confidence : 0.9,
        provider: this.name,
      };
    });
  }
}

/** Tries the paid provider first, then falls back to what the page says. */
class ChainedEnrichmentProvider implements EnrichmentProvider {
  readonly name = "chained";
  readonly resolvesContacts: boolean;

  constructor(private readonly chain: EnrichmentProvider[]) {
    this.resolvesContacts = chain.some((p) => p.resolvesContacts);
  }

  async enrich(
    candidate: RawCandidate,
    context?: { markdown?: string }
  ): Promise<EnrichmentResult | undefined> {
    for (const provider of this.chain) {
      try {
        const result = await provider.enrich(candidate, context);
        if (result?.email) return result;
      } catch (error) {
        console.error(`[enrichment] ${provider.name} failed`, (error as Error).message);
      }
    }
    return undefined;
  }
}

let provider: EnrichmentProvider | undefined;

export function enrichmentProvider(): EnrichmentProvider {
  if (provider) return provider;
  const chain: EnrichmentProvider[] = [];
  const url = process.env.ENRICHMENT_API_URL?.trim();
  if (features.enrichment && url) {
    chain.push(new HttpEnrichmentProvider(url, env.enrichmentApiKey!));
  }
  chain.push(new PageDerivedEnrichmentProvider());
  provider = new ChainedEnrichmentProvider(chain);
  return provider;
}
