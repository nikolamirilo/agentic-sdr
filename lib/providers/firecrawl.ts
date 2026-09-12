import Firecrawl from "@mendable/firecrawl-js";
import { env } from "@/lib/env";
import type { ExtractionProvider } from "@/lib/providers/types";
import { pLimit, resilient } from "@/lib/providers/resilience";
import { cached } from "@/lib/providers/cache";

/** Firecrawl answers "what does this specific page actually say". Extraction only. */

let client: Firecrawl | undefined;

function firecrawl(): Firecrawl {
  if (!env.firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is not set");
  if (!client) client = new Firecrawl({ apiKey: env.firecrawlApiKey });
  return client;
}

/**
 * One limiter for the whole process, not one per call site.
 *
 * Firecrawl meters per minute. Two graph nodes each running their own
 * five-wide batch is ten concurrent scrapes, which exhausts a free-tier window
 * in seconds — which is exactly what happened the first time this ran. The cap
 * belongs to the provider, so every caller shares it.
 */
const limit = pLimit(Number(process.env.FIRECRAWL_CONCURRENCY ?? 3));

export class FirecrawlExtractionProvider implements ExtractionProvider {
  readonly name = "firecrawl";

  constructor(private readonly productId?: string) {}

  async map(domain: string, opts: { limit?: number; search?: string } = {}): Promise<string[]> {
    const url = domain.includes("://") ? domain : `https://${domain}`;
    return cached(this.productId, ["firecrawl.map", url, opts], () =>
      limit(() => resilient({ label: `firecrawl.map(${url})`, timeoutMs: 30_000 }, async () => {
        const result = await firecrawl().map(url, {
          limit: opts.limit ?? 60,
          search: opts.search,
          sitemap: "include",
        });
        return (result.links ?? []).map((l) => l.url).filter(Boolean);
      }))
    );
  }

  async scrape<T>(
    url: string,
    schema: unknown,
    opts: { prompt?: string } = {}
  ): Promise<{ json: T | undefined; markdown: string; url: string }> {
    return cached(this.productId, ["firecrawl.scrape.json", url, opts.prompt ?? null], () =>
      limit(() => resilient({ label: `firecrawl.scrape(${url})`, timeoutMs: 30_000 }, async () => {
        const doc = await firecrawl().scrape(url, {
          formats: [
            "markdown",
            { type: "json", schema: schema as never, prompt: opts.prompt },
          ],
          onlyMainContent: true,
          timeout: 25_000,
        });
        return {
          json: doc.json as T | undefined,
          markdown: doc.markdown ?? "",
          url: doc.metadata?.sourceURL ?? url,
        };
      }))
    );
  }

  async scrapeText(url: string): Promise<{ markdown: string; url: string; title?: string }> {
    return cached(this.productId, ["firecrawl.scrape.text", url], () =>
      limit(() => resilient({ label: `firecrawl.scrapeText(${url})`, timeoutMs: 30_000 }, async () => {
        const doc = await firecrawl().scrape(url, {
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: 25_000,
        });
        return {
          markdown: doc.markdown ?? "",
          url: doc.metadata?.sourceURL ?? url,
          title: doc.metadata?.title ?? undefined,
        };
      }))
    );
  }
}

export function extractionProvider(productId?: string): ExtractionProvider {
  return new FirecrawlExtractionProvider(productId);
}

/**
 * Picks the pages worth reading from a mapped site. Crawling the whole site is
 * slow and adds nothing; these paths are where a product actually describes
 * itself.
 */
const PAGE_PRIORITIES: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\/(pricing|plans)\/?$/i, weight: 100 },
  { pattern: /\/(customers|case-stud|success|testimonial)/i, weight: 95 },
  { pattern: /\/(product|features|platform|solutions?)\/?$/i, weight: 90 },
  { pattern: /\/(about|company|who-we-are)\/?$/i, weight: 80 },
  { pattern: /\/(docs|documentation|developers?)\/?$/i, weight: 70 },
  { pattern: /\/(use-cases?|industries)/i, weight: 65 },
  { pattern: /\/(blog|resources)\/?$/i, weight: 30 },
];

export function pickImportantPages(urls: string[], homepage: string, limit = 8): string[] {
  const seen = new Set<string>();
  const scored = urls
    .map((url) => {
      let score = 0;
      try {
        const parsed = new URL(url);
        const depth = parsed.pathname.split("/").filter(Boolean).length;
        if (depth === 0) score = 110; // the homepage itself
        for (const { pattern, weight } of PAGE_PRIORITIES) {
          if (pattern.test(parsed.pathname)) score = Math.max(score, weight);
        }
        score -= depth * 3;
      } catch {
        return undefined;
      }
      return { url, score };
    })
    .filter((x): x is { url: string; score: number } => Boolean(x) && x!.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  const home = homepage.includes("://") ? homepage : `https://${homepage}`;
  picked.push(home);
  seen.add(home.replace(/\/$/, ""));

  for (const { url } of scored) {
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(url);
    if (picked.length >= limit) break;
  }
  return picked;
}
