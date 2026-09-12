/**
 * The tool catalogue, kept free of server imports so the skill editor in the
 * browser can render the same list the graphs enforce.
 */

export const ALL_TOOLS = [
  "exa.search",
  "exa.findSimilar",
  "firecrawl.map",
  "firecrawl.scrape",
  "enrichment.lookup",
  "linkedin.searchPeople",
  "linkedin.searchCompanies",
  "linkedin.enrichProfile",
  "linkedin.enrichCompany",
] as const;

export type ToolName = (typeof ALL_TOOLS)[number];

/** What each tool does, in the words of someone deciding whether to allow it. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  "exa.search": "Web search for candidate companies and pages.",
  "exa.findSimilar": "Finds companies that look like one you already have.",
  "firecrawl.map": "Lists the URLs on a site before reading any of them.",
  "firecrawl.scrape": "Reads a page and returns its text.",
  "enrichment.lookup": "Looks up work email and phone for a named person.",
  "linkedin.searchPeople": "Searches people by title, seniority and company.",
  "linkedin.searchCompanies": "Searches companies by industry, size and location.",
  "linkedin.enrichProfile": "Reads a person's full LinkedIn profile.",
  "linkedin.enrichCompany": "Reads a company's full LinkedIn page.",
};

/** Only research runs hand tools to the model; outreach drafting never does. */
export function toolsApplyTo(kind: string): boolean {
  return kind === "research";
}
