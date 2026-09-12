/**
 * identity_key — one normalized string per human, so a single indexed lookup
 * answers "have we seen this person". Computed before enrichment, because
 * enrichment is the expensive step.
 *
 * Resolution order:
 *   1. lowercased email
 *   2. normalized professional profile URL, path only, no query string
 *   3. slug(company_domain) + ':' + slug(full_name)
 */

export function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeDomain(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** Strips query, fragment, trailing slash and the www prefix. */
export function normalizeProfileUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path || path === "") return undefined;
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

export function computeIdentityKey(input: {
  email?: string | null;
  profileUrl?: string | null;
  companyDomain?: string | null;
  company?: string | null;
  fullName?: string | null;
  sourceUrl?: string | null;
}): string | undefined {
  const email = input.email?.trim().toLowerCase();
  if (email && email.includes("@")) return `email:${email}`;

  const profile = normalizeProfileUrl(input.profileUrl);
  if (profile) return `url:${profile}`;

  const domain =
    normalizeDomain(input.companyDomain) ??
    normalizeDomain(input.company) ??
    normalizeDomain(input.sourceUrl);
  const name = input.fullName?.trim();
  if (domain && name) return `name:${slug(domain)}:${slug(name)}`;

  // Company-level candidate with no named human yet: the domain still dedupes.
  if (domain) return `company:${slug(domain)}`;

  return undefined;
}
