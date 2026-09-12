import Exa from "exa-js";
import { env } from "@/lib/env";
import type { DiscoveryProvider } from "@/lib/providers/types";
import type { RawCandidate } from "@/lib/types";
import { pLimit, resilient } from "@/lib/providers/resilience";
import { cached } from "@/lib/providers/cache";
import { normalizeDomain } from "@/lib/identity";

/** Exa answers "who or what exists that matches this". Discovery only. */

let client: Exa | undefined;

function exa(): Exa {
  if (!env.exaApiKey) throw new Error("EXA_API_KEY (or EXO_API_KEY) is not set");
  if (!client) client = new Exa(env.exaApiKey);
  return client;
}

/** Process-wide cap, for the same reason as Firecrawl's. */
const limit = pLimit(Number(process.env.EXA_CONCURRENCY ?? 4));

type ExaResultLike = {
  title: string | null;
  url: string;
  id: string;
  text?: string;
  author?: string;
  publishedDate?: string;
  entities?: unknown[];
};

function toCandidate(result: ExaResultLike, query?: string): RawCandidate {
  const domain = normalizeDomain(result.url);
  const entity = Array.isArray(result.entities) ? (result.entities[0] as Record<string, unknown>) : undefined;
  const props = (entity?.properties ?? {}) as Record<string, unknown>;

  const fullName =
    typeof props.name === "string" && entity?.type === "person" ? props.name : undefined;
  const company =
    (typeof props.name === "string" && entity?.type === "company" ? props.name : undefined) ??
    (typeof (props.company as Record<string, unknown>)?.name === "string"
      ? ((props.company as Record<string, unknown>).name as string)
      : undefined);

  return {
    fullName: fullName ?? result.author ?? undefined,
    company: company ?? result.title ?? undefined,
    companyDomain: domain,
    role: typeof props.position === "string" ? props.position : undefined,
    profileUrl: entity?.type === "person" ? result.url : undefined,
    sourceUrl: result.url,
    title: result.title ?? undefined,
    snippet: result.text ? result.text.slice(0, 1500) : undefined,
    evidence: { exaEntity: entity ?? null, publishedDate: result.publishedDate ?? null },
    query,
  };
}

export class ExaDiscoveryProvider implements DiscoveryProvider {
  readonly name = "exa";

  constructor(private readonly productId?: string) {}

  async search(
    q: string,
    opts: { limit: number; type?: "company" | "person"; excludeDomains?: string[] }
  ): Promise<RawCandidate[]> {
    const response = await cached(this.productId, ["exa.search", q, opts], () =>
      limit(() => resilient({ label: `exa.search(${q.slice(0, 40)})` }, async () => {
        const result = await exa().searchAndContents(q, {
          numResults: opts.limit,
          category: opts.type === "person" ? "people" : opts.type === "company" ? "company" : undefined,
          excludeDomains: opts.excludeDomains,
          text: { maxCharacters: 2000 },
        });
        return result.results as ExaResultLike[];
      }))
    );
    return (response as ExaResultLike[]).map((r) => toCandidate(r, q));
  }

  async findSimilar(url: string, opts: { limit: number }): Promise<RawCandidate[]> {
    const response = await cached(this.productId, ["exa.findSimilar", url, opts], () =>
      limit(() => resilient({ label: `exa.findSimilar(${url})` }, async () => {
        const result = await exa().findSimilarAndContents(url, {
          numResults: opts.limit,
          excludeSourceDomain: true,
          text: { maxCharacters: 2000 },
        } as never);
        return result.results as ExaResultLike[];
      }))
    );
    return (response as ExaResultLike[]).map((r) => toCandidate(r, `similar:${url}`));
  }
}

export function discoveryProvider(productId?: string): DiscoveryProvider {
  return new ExaDiscoveryProvider(productId);
}
