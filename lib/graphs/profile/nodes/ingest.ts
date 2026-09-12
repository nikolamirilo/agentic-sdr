import { z } from "zod";
import { extractText } from "unpdf";
import { extractionProvider, pickImportantPages } from "@/lib/providers/firecrawl";
import { discoveryProvider } from "@/lib/providers/exa";
import { getStorage } from "@/lib/providers/storage";
import { getSource, listSources, updateSourceText } from "@/lib/db/queries";
import { mapWithLimit, DEFAULT_CONCURRENCY } from "@/lib/providers/resilience";
import { sha256 } from "@/lib/crypto";
import { normalizeDomain } from "@/lib/identity";
import type { ProfileState, ProfileUpdate, RawSource } from "@/lib/graphs/profile/state";

const MAX_PDF_PAGES = 40;

/** Decides what there is to read. Cheap, and it makes the fan-out explicit. */
export async function ingestPlan(state: ProfileState): Promise<ProfileUpdate> {
  const sources = await listSources(state.productId);
  const fileIds = sources.filter((s) => s.kind === "pdf").map((s) => s.id);
  const links = [
    ...state.links,
    ...sources.filter((s) => s.kind === "link" && s.uri).map((s) => s.uri!),
  ];
  return { fileIds: [...new Set([...state.fileIds, ...fileIds])], links: [...new Set(links)] };
}

const PageExtractSchema = z.object({
  headline: z.string().describe("The main claim this page makes"),
  summary: z.string().describe("What this page says, in three sentences"),
  capabilities: z.array(z.string()).describe("Product capabilities named on this page"),
  customerTypes: z.array(z.string()).describe("Kinds of customer named on this page"),
  jargon: z
    .array(z.string())
    .describe("Domain-specific terms of art used verbatim on this page, excluding common English"),
});

/**
 * Firecrawl `map` on the domain, pick up to 8 pages by path heuristics, then
 * scrape each with a JSON extraction schema. Crawling the whole site is slow
 * and adds nothing.
 */
export async function scrapeSite(state: ProfileState): Promise<ProfileUpdate> {
  if (!state.websiteUrl) return {};
  const extraction = extractionProvider(state.productId);

  let pages: string[];
  try {
    const mapped = await extraction.map(state.websiteUrl, { limit: 80 });
    pages = pickImportantPages(mapped, state.websiteUrl, 8);
  } catch (error) {
    // A failed map is not a failed run: read the homepage and move on.
    pages = [state.websiteUrl.includes("://") ? state.websiteUrl : `https://${state.websiteUrl}`];
    return await scrapePages(pages, state.productId, [
      `scrape_site: map failed (${(error as Error).message}), fell back to the homepage`,
    ]);
  }

  return scrapePages(pages, state.productId, []);
}

async function scrapePages(
  pages: string[],
  productId: string,
  errors: string[]
): Promise<ProfileUpdate> {
  const extraction = extractionProvider(productId);
  const results = await mapWithLimit(pages, DEFAULT_CONCURRENCY, (url) =>
    extraction.scrape<z.infer<typeof PageExtractSchema>>(url, PageExtractSchema, {
      prompt: "Extract what this page says about the product and who it is for.",
    })
  );

  const rawSources: RawSource[] = [];
  const evidenceUrls: string[] = [];
  const failures = [...errors];

  results.forEach((result, index) => {
    if (!result.ok) {
      failures.push(`scrape_site: ${pages[index]} failed (${(result.error as Error).message})`);
      return;
    }
    const { json, markdown, url } = result.value;
    const structured = json
      ? `Headline: ${json.headline}\nSummary: ${json.summary}\nCapabilities: ${json.capabilities.join(", ")}\nCustomer types: ${json.customerTypes.join(", ")}\nTerms of art: ${json.jargon.join(", ")}`
      : "";
    const text = [structured, markdown].filter(Boolean).join("\n\n").slice(0, 20_000);
    if (!text.trim()) return;
    rawSources.push({ kind: "website", uri: url, text });
    evidenceUrls.push(url);
  });

  return { rawSources, evidenceUrls, errors: failures };
}

/**
 * Extract text server side, chunk, then merge. Capped at 40 pages — a longer
 * deck is almost always a repetition of the first 40.
 */
export async function parsePdfs(state: ProfileState): Promise<ProfileUpdate> {
  if (state.fileIds.length === 0) return {};
  const storage = getStorage();

  const results = await mapWithLimit(state.fileIds, 3, async (id) => {
    const source = await getSource(id);
    if (!source?.objectKey) throw new Error(`source ${id} has no stored object`);

    if (source.rawText && source.status === "ready") {
      return { uri: source.uri ?? source.objectKey, text: source.rawText, id };
    }

    const bytes = await storage.get(source.objectKey);
    if (!bytes) throw new Error(`source ${id} object is missing from storage`);

    const { text, totalPages } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const pages = (text as string[]).slice(0, MAX_PDF_PAGES);
    const merged = pages
      .map((page, index) => `[page ${index + 1}]\n${page.trim()}`)
      .filter((page) => page.length > 20)
      .join("\n\n");
    const truncated =
      totalPages > MAX_PDF_PAGES
        ? `${merged}\n\n[truncated: ${totalPages - MAX_PDF_PAGES} further pages not read]`
        : merged;

    await updateSourceText(id, {
      rawText: truncated,
      checksum: sha256(bytes),
      status: "ready",
      sizeBytes: bytes.byteLength,
    });
    return { uri: source.uri ?? source.objectKey, text: truncated, id };
  });

  const rawSources: RawSource[] = [];
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (!result.ok) {
      const message = (result.error as Error).message;
      errors.push(`parse_pdfs: ${state.fileIds[index]} failed (${message})`);
      void updateSourceText(state.fileIds[index], { status: "failed", error: message });
      return;
    }
    rawSources.push({ kind: "pdf", uri: result.value.uri, text: result.value.text });
  });

  return { rawSources, errors };
}

/**
 * Exa neural search from what we already know, take the top 10, read the best 5.
 * This is where market context that is not on the company's own site comes from.
 */
export async function domainResearch(state: ProfileState): Promise<ProfileUpdate> {
  const discovery = discoveryProvider(state.productId);
  const extraction = extractionProvider(state.productId);
  const domain = normalizeDomain(state.websiteUrl);

  const seed =
    state.productName ||
    state.websiteUrl ||
    state.links[0] ||
    "business software";
  const queries = [
    `${seed} market overview and competitors`,
    `${seed} buyer pain points and workflows`,
  ];

  const errors: string[] = [];
  const urls: string[] = [];

  for (const query of queries) {
    try {
      const found = await discovery.search(query, {
        limit: 10,
        excludeDomains: domain ? [domain] : undefined,
      });
      urls.push(...found.map((c) => c.sourceUrl));
    } catch (error) {
      errors.push(`domain_research: search failed (${(error as Error).message})`);
    }
  }

  const unique = [...new Set(urls)].slice(0, 5);
  const results = await mapWithLimit(unique, DEFAULT_CONCURRENCY, (url) => extraction.scrapeText(url));

  const rawSources: RawSource[] = [];
  const evidenceUrls: string[] = [];
  results.forEach((result, index) => {
    if (!result.ok) {
      errors.push(`domain_research: ${unique[index]} failed (${(result.error as Error).message})`);
      return;
    }
    const text = result.value.markdown.slice(0, 12_000);
    if (!text.trim()) return;
    rawSources.push({
      kind: "research",
      uri: result.value.url,
      title: result.value.title,
      text,
    });
    evidenceUrls.push(result.value.url);
  });

  // Links the user supplied are read the same way.
  const linkResults = await mapWithLimit(state.links.slice(0, 5), DEFAULT_CONCURRENCY, (url) =>
    extraction.scrapeText(url)
  );
  linkResults.forEach((result, index) => {
    if (!result.ok) {
      errors.push(`domain_research: link ${state.links[index]} failed`);
      return;
    }
    rawSources.push({ kind: "link", uri: result.value.url, text: result.value.markdown.slice(0, 12_000) });
    evidenceUrls.push(result.value.url);
  });

  return { rawSources, evidenceUrls, errors };
}
