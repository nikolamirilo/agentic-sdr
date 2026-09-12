import type { SkillKind } from "@/lib/types";

/**
 * Ship with a populated selector. A skill is a named instruction block plus a
 * tool allowlist — behaviour changes by selecting a different skill, with no
 * code change and no prompt editing.
 */

export type SkillSeed = {
  slug: string;
  name: string;
  kind: SkillKind;
  instructions: string;
  toolAllowlist: string[];
};

export const DEFAULT_SKILLS: SkillSeed[] = [
  {
    slug: "hiring-signals",
    name: "Find hiring signals",
    kind: "research",
    toolAllowlist: ["exa.search", "exa.findSimilar", "firecrawl.scrape", "firecrawl.map"],
    instructions: `Prioritise companies that are visibly hiring for roles adjacent to the problem this product solves.

- Write queries around job posts, careers pages and recruiter activity, not around generic company descriptions.
- Treat an open role as the signal: name the role and where you saw it.
- A company that posted the role more than 90 days ago is a weak signal. Say so rather than inflating it.
- When two candidates tie, prefer the one hiring more than one such role.`,
  },
  {
    slug: "tech-stack-fit",
    name: "Match on tech stack",
    kind: "research",
    toolAllowlist: ["exa.search", "firecrawl.scrape", "firecrawl.map"],
    instructions: `Qualify on observable tooling rather than on stated intent.

- Look for stack evidence in engineering blogs, docs, status pages, integration directories and job descriptions.
- The signal is a named tool or protocol the candidate already runs that this product plugs into or replaces.
- Absence of evidence is not evidence: if the stack cannot be observed, mark the candidate unresolved rather than guessing.`,
  },
  {
    slug: "funding-and-growth",
    name: "Follow funding and growth",
    kind: "research",
    toolAllowlist: ["exa.search", "exa.findSimilar", "firecrawl.scrape"],
    instructions: `Target companies in a spending window.

- Weight recent funding rounds, headcount growth, new market entries and new office openings.
- Recency matters more than size: a seed round from last month beats a Series C from three years ago.
- Always name the round, the date and the source URL in the signal.
- Skip companies with public layoff news in the last six months.`,
  },
  {
    slug: "linkedin-buyers",
    name: "Source buyers on LinkedIn",
    kind: "research",
    toolAllowlist: [
      "linkedin.searchPeople",
      "linkedin.enrichProfile",
      "linkedin.enrichCompany",
      "exa.search",
      "firecrawl.scrape",
    ],
    instructions: `Go after the person, not the company page.

- The LinkedIn facets are the primary source here: pick the two or three job titles the buyer
  actually holds, and let the web queries cover the situation the company is in.
- Titles are exact strings on LinkedIn. "VP Engineering" and "Head of Engineering" are two
  different searches; "engineering leadership" is neither and returns nothing.
- Tenure is the signal worth reading: someone under six months into the role is still choosing
  tools, and someone who just moved from a company that already buys this is a warm start.
- Name the role, the company and the start date in the signal. "Senior decision maker" is not
  a signal.`,
  },
  {
    slug: "signal-first-email",
    name: "Lead with the signal",
    kind: "outreach",
    toolAllowlist: [],
    instructions: `Open on the specific thing you observed about this company, in the first sentence.

- Sentence one is the signal, with enough detail that it could not have been sent to anyone else.
- Sentence two connects that signal to one concrete consequence they already feel.
- Sentence three is the product, in one line, in their vocabulary.
- Close with a low-friction ask: a question, not a meeting request.
- Under 120 words. No greeting adjectives, no "I hope this finds you well", no bullet lists.`,
  },
  {
    slug: "peer-proof",
    name: "Lead with peer proof",
    kind: "outreach",
    toolAllowlist: [],
    instructions: `Open with a comparable company, then the outcome.

- Name a peer of similar size and segment, and what changed for them, before mentioning the product.
- Use the domain's own vocabulary for the outcome, not generic business language.
- One number, if a real one is available. Never invent one, and never use a rounded placeholder.
- Close by asking whether the same problem is live for them.
- Under 120 words.`,
  },
];
