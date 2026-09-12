/**
 * The tool catalogue.
 *
 * A tool is a capability the loop can call; the action it takes is a parameter,
 * not a separate entry. That keeps the allowlist short enough for a person to
 * reason about — you grant "may use LinkedIn", not four separate LinkedIn verbs.
 *
 * Deliberately free of server imports so the skill editor in the browser can
 * render exactly the list the graphs enforce.
 */

export const ALL_TOOLS = [
  "exoSearch",
  "firecrawlSearch",
  "linkedinSearch",
  "contactLookup",
] as const;

export type ToolName = (typeof ALL_TOOLS)[number];

/** What each tool does, in the words of someone deciding whether to allow it. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  exoSearch: "Neural web search. Finds companies and pages that match a description.",
  firecrawlSearch: "Reads the web. Lists a site's URLs, then pulls the text off the pages.",
  linkedinSearch: "Searches and reads LinkedIn people and companies.",
  contactLookup: "Finds a work email or phone for a named person.",
};

/** The actions each tool accepts, shown in the skill editor so the grant is legible. */
export const TOOL_ACTIONS: Record<ToolName, Array<{ action: string; summary: string }>> = {
  exoSearch: [
    { action: "search", summary: "Search the web from a natural-language query" },
    { action: "findSimilar", summary: "Find companies that look like one you already have" },
  ],
  firecrawlSearch: [
    { action: "map", summary: "List the URLs on a site without reading them" },
    { action: "scrape", summary: "Read a page and extract structured fields" },
    { action: "readPage", summary: "Read a page as plain text" },
  ],
  linkedinSearch: [
    { action: "people", summary: "Search people by title, seniority and company" },
    { action: "companies", summary: "Search companies by industry, size and location" },
    { action: "profile", summary: "Read a person's full profile" },
    { action: "company", summary: "Read a company's full page" },
  ],
  contactLookup: [{ action: "email", summary: "Resolve a work email and phone" }],
};

/** Only research runs call tools; outreach drafting never does. */
export function toolsApplyTo(kind: string): boolean {
  return kind === "research";
}

/**
 * Allowlists written against the old fine-grained names still exist in the
 * database and in anything a user saved. Fold them onto the tool that now owns
 * the capability.
 */
const LEGACY_TOOL_NAMES: Record<string, ToolName> = {
  "exa.search": "exoSearch",
  "exa.findSimilar": "exoSearch",
  "firecrawl.map": "firecrawlSearch",
  "firecrawl.scrape": "firecrawlSearch",
  "enrichment.lookup": "contactLookup",
  "linkedin.searchPeople": "linkedinSearch",
  "linkedin.searchCompanies": "linkedinSearch",
  "linkedin.enrichProfile": "linkedinSearch",
  "linkedin.enrichCompany": "linkedinSearch",
};

export function normalizeToolNames(names: readonly string[]): ToolName[] {
  const out = new Set<ToolName>();
  for (const name of names) {
    if ((ALL_TOOLS as readonly string[]).includes(name)) {
      out.add(name as ToolName);
      continue;
    }
    const mapped = LEGACY_TOOL_NAMES[name];
    if (mapped) out.add(mapped);
  }
  return [...out];
}
