import { notFound } from "next/navigation";
import {
  getCurrentProfile,
  getProduct,
  getRun,
  listLeadsForRun,
  listMessagesForLeads,
  listProductsWithStatus,
  listRuns,
  listSources,
} from "@/lib/db/queries";
import { availableSkills } from "@/lib/skills/registry";
import { connectedAccount, gmailConfigured } from "@/lib/providers/gmail";
import { features } from "@/lib/env";
import { hasModelProvider } from "@/lib/llm";
import { Wizard, type WizardInitialState } from "@/components/wizard/Wizard";
import type { StepId } from "@/components/wizard/steps";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Everything the flow needs for a cold load is resolved here. Once it is
 * running, step changes are local and data changes go through the API.
 */
export default async function ProductFlow(props: PageProps<"/admin/products/[productId]">) {
  const { productId } = await props.params;
  const params = await props.searchParams;

  const product = await getProduct(productId).catch(() => undefined);
  if (!product) notFound();

  const step = clampStep(Number(single(params.step) ?? 1));
  const runIdParam = single(params.run);

  const [profile, sources, skills, products, runs] = await Promise.all([
    getCurrentProfile(product.id).catch(() => undefined),
    listSources(product.id).catch(() => []),
    availableSkills(undefined, product.id).catch(() => []),
    listProductsWithStatus().catch(() => []),
    listRuns(product.id).catch(() => []),
  ]);

  // Prefer the run named in the URL; otherwise pick up the most recent one.
  const named = runIdParam ? await getRun(runIdParam).catch(() => undefined) : undefined;
  const run = named?.productId === product.id ? named : runs[0];

  let runId: string | null = null;
  let targetCount = 5;
  let leads: Lead[] = [];
  let messages: Awaited<ReturnType<typeof listMessagesForLeads>> = [];

  if (run) {
    runId = run.id;
    targetCount = run.targetCount;
    leads = await listLeadsForRun(run.id).catch(() => []);
    messages = await listMessagesForLeads(leads.map((lead) => lead.id)).catch(() => []);
  }

  const connectedEmail = gmailConfigured()
    ? ((await connectedAccount(product.id).catch(() => undefined))?.email ?? null)
    : null;

  const missing = [
    !hasModelProvider() && "a model provider (XAI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)",
    !features.exa && "EXA_API_KEY",
    !features.firecrawl && "FIRECRAWL_API_KEY",
  ].filter(Boolean) as string[];

  const initial: WizardInitialState = {
    step,
    product: { id: product.id, name: product.name, websiteUrl: product.websiteUrl },
    products: products.map((item) => ({
      id: item.id,
      name: item.name,
      websiteUrl: item.websiteUrl,
      profileVersion: item.profileVersion,
      leadCount: item.leadCount,
    })),
    profile: profile ?? null,
    sources: sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      uri: source.uri,
      status: source.status,
    })),
    skills,
    runId,
    targetCount,
    leads,
    messages: messages.map((message) => ({
      id: message.id,
      leadId: message.leadId,
      subject: message.subject,
      body: message.body,
      angle: message.angle,
      critique: message.critique as { pass: boolean; fixes: string[] } | null,
      status: message.status,
      error: message.error,
      sentAt: message.sentAt,
    })),
    gmail: { configured: gmailConfigured(), connectedEmail },
    setupWarning:
      missing.length > 0
        ? `Missing ${missing.join(", ")}. Profile generation and research runs need these before they can run.`
        : null,
  };

  return <Wizard initial={initial} />;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampStep(value: number): StepId {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value))) as StepId;
}
