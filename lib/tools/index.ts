import { features } from "@/lib/env";
import { recordToolCall } from "@/lib/llm";
import { discoveryProvider } from "@/lib/providers/exa";
import { extractionProvider } from "@/lib/providers/firecrawl";
import { enrichmentProvider } from "@/lib/providers/enrichment";
import { linkedInProvider } from "@/lib/providers/up2data";
import type {
  CompanySearchFilters,
  EnrichmentResult,
  LinkedInCompany,
  LinkedInProfile,
  PeopleSearchFilters,
} from "@/lib/providers/types";
import type { RawCandidate } from "@/lib/types";
import { ALL_TOOLS, type ToolName } from "@/lib/skills/tools";

/**
 * The tool layer.
 *
 * Graph nodes call tools through here rather than reaching for a provider, so
 * one place decides three things: whether the run's skills granted the tool,
 * whether it is configured at all, and that the call gets metered against the
 * run's budget. Adding a provider means adding an action here, not touching
 * five nodes.
 *
 * Tools are coarse on purpose. The action is a parameter, which keeps a skill's
 * allowlist to a handful of entries a person can actually reason about.
 */

export type ToolContext = {
  productId: string;
  runId?: string;
  /** The union of the selected skills' allowlists. */
  allowedTools: Set<string>;
};

/* ------------------------------------------------------------------ calls */

export type ExoSearchCall =
  | {
      tool: "exoSearch";
      action: "search";
      query: string;
      limit: number;
      type?: "company" | "person";
      excludeDomains?: string[];
    }
  | { tool: "exoSearch"; action: "findSimilar"; url: string; limit: number };

export type FirecrawlSearchCall =
  | { tool: "firecrawlSearch"; action: "map"; url: string; limit?: number; search?: string }
  | { tool: "firecrawlSearch"; action: "scrape"; url: string; schema: unknown; prompt?: string }
  | { tool: "firecrawlSearch"; action: "readPage"; url: string };

export type LinkedinSearchCall =
  | { tool: "linkedinSearch"; action: "people"; filters: PeopleSearchFilters; maxResults?: number }
  | {
      tool: "linkedinSearch";
      action: "companies";
      filters: CompanySearchFilters;
      maxResults?: number;
    }
  | { tool: "linkedinSearch"; action: "profile"; url: string }
  | {
      tool: "linkedinSearch";
      action: "company";
      target: { url?: string; domain?: string; linkedinId?: string };
    };

export type ContactLookupCall = {
  tool: "contactLookup";
  action: "email";
  candidate: RawCandidate;
  markdown?: string;
};

export type ToolCall =
  | ExoSearchCall
  | FirecrawlSearchCall
  | LinkedinSearchCall
  | ContactLookupCall;

/* ---------------------------------------------------------------- results */

type ResultFor<C extends ToolCall> = C extends { tool: "exoSearch" }
  ? RawCandidate[]
  : C extends { tool: "firecrawlSearch"; action: "map" }
    ? string[]
    : C extends { tool: "firecrawlSearch"; action: "scrape" }
      ? { json: unknown; markdown: string; url: string }
      : C extends { tool: "firecrawlSearch"; action: "readPage" }
        ? { markdown: string; url: string; title?: string }
        : C extends { tool: "linkedinSearch"; action: "people" | "companies" }
          ? RawCandidate[]
          : C extends { tool: "linkedinSearch"; action: "profile" }
            ? LinkedInProfile | undefined
            : C extends { tool: "linkedinSearch"; action: "company" }
              ? LinkedInCompany | undefined
              : C extends { tool: "contactLookup" }
                ? EnrichmentResult | undefined
                : never;

export class ToolNotAllowedError extends Error {
  constructor(public readonly tool: ToolName) {
    super(`The skills selected for this run did not grant ${tool}`);
    this.name = "ToolNotAllowedError";
  }
}

export class ToolNotConfiguredError extends Error {
  constructor(
    public readonly tool: ToolName,
    detail: string
  ) {
    super(`${tool} is not configured: ${detail}`);
    this.name = "ToolNotConfiguredError";
  }
}

/* -------------------------------------------------------------- avail. */

/** Why a tool cannot run, or undefined when it can. */
export function toolUnavailableReason(
  ctx: ToolContext,
  tool: ToolName
): "not_allowed" | "not_configured" | undefined {
  if (!ctx.allowedTools.has(tool)) return "not_allowed";

  const configured: Record<ToolName, boolean> = {
    exoSearch: features.exa,
    firecrawlSearch: features.firecrawl,
    linkedinSearch: features.up2data,
    // Falls back to reading contact details off the page, which always works.
    contactLookup: true,
  };
  return configured[tool] ? undefined : "not_configured";
}

/** The gate nodes use before committing to a branch. */
export function canUseTool(ctx: ToolContext, tool: ToolName): boolean {
  return toolUnavailableReason(ctx, tool) === undefined;
}

export function availableTools(ctx: ToolContext): ToolName[] {
  return ALL_TOOLS.filter((tool) => canUseTool(ctx, tool));
}

/* ------------------------------------------------------------- dispatch */

/**
 * Runs one tool call. Throws when the tool was not granted or is not
 * configured; provider failures propagate as they always did, so the retry and
 * concurrency behaviour in the provider layer still applies.
 */
export async function runTool<C extends ToolCall>(
  call: C,
  ctx: ToolContext
): Promise<ResultFor<C>> {
  const reason = toolUnavailableReason(ctx, call.tool);
  if (reason === "not_allowed") throw new ToolNotAllowedError(call.tool);
  if (reason === "not_configured") {
    throw new ToolNotConfiguredError(call.tool, "no credentials for this deployment");
  }

  // Metered before the call, so a failing tool still shows up in the budget.
  await recordToolCall(ctx.runId, 1);

  switch (call.tool) {
    case "exoSearch": {
      const exa = discoveryProvider(ctx.productId);
      if (call.action === "search") {
        return (await exa.search(call.query, {
          limit: call.limit,
          type: call.type,
          excludeDomains: call.excludeDomains,
        })) as ResultFor<C>;
      }
      return (await exa.findSimilar(call.url, { limit: call.limit })) as ResultFor<C>;
    }

    case "firecrawlSearch": {
      const firecrawl = extractionProvider(ctx.productId);
      if (call.action === "map") {
        return (await firecrawl.map(call.url, {
          limit: call.limit,
          search: call.search,
        })) as ResultFor<C>;
      }
      if (call.action === "scrape") {
        return (await firecrawl.scrape(call.url, call.schema, {
          prompt: call.prompt,
        })) as ResultFor<C>;
      }
      return (await firecrawl.scrapeText(call.url)) as ResultFor<C>;
    }

    case "linkedinSearch": {
      const linkedin = linkedInProvider(ctx.productId);
      if (call.action === "people") {
        return (await linkedin.searchPeople(call.filters, {
          maxResults: call.maxResults,
        })) as ResultFor<C>;
      }
      if (call.action === "companies") {
        return (await linkedin.searchCompanies(call.filters, {
          maxResults: call.maxResults,
        })) as ResultFor<C>;
      }
      if (call.action === "profile") {
        return (await linkedin.enrichProfile(call.url)) as ResultFor<C>;
      }
      return (await linkedin.enrichCompany(call.target)) as ResultFor<C>;
    }

    case "contactLookup": {
      const contacts = enrichmentProvider();
      return (await contacts.enrich(call.candidate, {
        markdown: call.markdown,
      })) as ResultFor<C>;
    }
  }
}

/** Builds the context a run's nodes share. */
export function toolContext(input: {
  productId: string;
  runId?: string;
  allowedTools: Set<string>;
}): ToolContext {
  return input;
}
