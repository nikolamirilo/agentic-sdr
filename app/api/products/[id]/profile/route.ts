import { z } from "zod";
import { profileGraph } from "@/lib/graphs/profile/graph";
import type { ProfileState } from "@/lib/graphs/profile/state";
import {
  getCurrentProfile,
  getProduct,
  insertProfileVersion,
  listProfileVersions,
  listSources,
} from "@/lib/db/queries";
import {
  CriterionSchema,
  DisqualifierSchema,
  DomainKnowledgeSchema,
  DomainTermSchema,
  ExampleEmailSchema,
  IcpSchema,
  ProductDefinitionSchema,
} from "@/lib/types";
import { hasModelProvider } from "@/lib/llm";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

/** Human labels for the node names the graph streams back. */
const NODE_LABELS: Record<string, string> = {
  ingest_plan: "Planning ingest",
  scrape_site: "Reading the website",
  parse_pdfs: "Reading uploaded documents",
  domain_research: "Researching the domain",
  extract_product_definition: "Extracting the product definition",
  derive_icp: "Deriving the ideal customer profile",
  derive_domain_language: "Capturing domain language",
  derive_disqualifiers: "Writing disqualifiers",
  derive_scoring_criteria: "Writing scoring criteria",
  assemble_profile: "Assembling the profile",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/products/[id]/profile">) {
  const { id } = await ctx.params;
  try {
    const profile = await getCurrentProfile(id);
    if (!profile) return apiError("This product has no profile yet", 404);
    const versions = await listProfileVersions(id);
    return apiOk({
      profile,
      versions: versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt })),
    });
  } catch (error) {
    return handleError(error, "GET profile");
  }
}

/**
 * Starts profile generation and streams node transitions as they happen. The
 * graph writes the profile itself; this route only narrates.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/products/[id]/profile">) {
  const { id } = await ctx.params;

  if (!hasModelProvider()) {
    return apiError(
      "No model provider is configured. Set XAI_API_KEY (or GROK_API_KEY), ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
      503
    );
  }

  const product = await getProduct(id);
  if (!product) return apiError("Product not found", 404);

  const sources = await listSources(id);
  const links = sources.filter((s) => s.kind === "link" && s.uri).map((s) => s.uri!);
  const fileIds = sources.filter((s) => s.kind === "pdf").map((s) => s.id);

  if (!product.websiteUrl && links.length === 0 && fileIds.length === 0) {
    return apiError("Add a website, a link or a document before generating a profile", 400);
  }

  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: string, data: unknown) => {
        try {
          controller.enqueue(frame(event, data));
        } catch {
          /* client went away */
        }
      };

      push("open", { productId: id, nodes: Object.keys(NODE_LABELS) });

      try {
        const graph = profileGraph();
        const updates = await graph.stream(
          {
            productId: id,
            productName: product.name,
            websiteUrl: product.websiteUrl ?? undefined,
            links,
            fileIds,
          },
          { streamMode: "updates", recursionLimit: 40 }
        );

        let latest: Partial<ProfileState> = {};

        for await (const chunk of updates) {
          for (const [node, update] of Object.entries(chunk as Record<string, Partial<ProfileState>>)) {
            latest = { ...latest, ...update };
            push("node", {
              node,
              label: NODE_LABELS[node] ?? node,
              // Enough to render progress, not enough to flood the wire.
              summary: summarize(node, update),
              errors: update.errors ?? [],
            });
          }
        }

        const profile = await getCurrentProfile(id);
        if (!profile) {
          push("error", { message: "The graph finished without writing a profile", errors: latest.errors ?? [] });
        } else {
          push("done", { profile, errors: latest.errors ?? [] });
        }
      } catch (error) {
        push("error", { message: (error as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function summarize(node: string, update: Partial<ProfileState>): string {
  switch (node) {
    case "scrape_site":
    case "parse_pdfs":
    case "domain_research":
      return `${update.rawSources?.length ?? 0} sources read`;
    case "extract_product_definition":
      return update.productDefinition?.oneLiner ? "definition extracted" : "";
    case "derive_icp":
      return update.icp?.summary ? "ICP derived" : "";
    case "derive_domain_language":
      return `${update.domainLanguage?.length ?? 0} terms with evidence`;
    case "derive_disqualifiers":
      return `${update.disqualifiers?.length ?? 0} rules`;
    case "derive_scoring_criteria":
      return `${update.scoringCriteria?.length ?? 0} yes/no criteria`;
    case "assemble_profile":
      return update.profileId ? "profile written" : "";
    default:
      return "";
  }
}

const PatchProfileSchema = z.object({
  productDefinition: ProductDefinitionSchema,
  icp: IcpSchema,
  domainKnowledge: DomainKnowledgeSchema,
  domainLanguage: z.object({ terms: z.array(DomainTermSchema) }),
  disqualifiers: z.array(DisqualifierSchema),
  scoringCriteria: z.array(CriterionSchema),
  exampleEmails: z.array(ExampleEmailSchema).optional(),
});

/** Every edit writes version N+1. Edits never destroy history. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/products/[id]/profile">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, PatchProfileSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const existing = await getCurrentProfile(id);
    if (!existing) return apiError("This product has no profile to edit", 404);

    const profile = await insertProfileVersion(id, {
      ...parsed.data,
      exampleEmails: parsed.data.exampleEmails ?? existing.exampleEmails,
    });
    return apiOk({ profile });
  } catch (error) {
    return handleError(error, "PATCH profile");
  }
}
