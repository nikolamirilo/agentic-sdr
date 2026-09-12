import { notFound } from "next/navigation";
import {
  getCurrentProfile,
  getProduct,
  getRun,
  listLeadsForRun,
  listMessagesForLeads,
  listProductsWithStatus,
  listRunSummaries,
  listSources,
} from "@/lib/db/queries";
import { availableSkills } from "@/lib/skills/registry";
import { connectedAccount, gmailConfigured } from "@/lib/providers/gmail";
import { features } from "@/lib/env";
import { hasModelProvider } from "@/lib/llm";
import { Wizard, type WizardInitialState } from "@/components/wizard/Wizard";
import {
  TOTAL_STEPS,
  furthestReachableStep,
  stepForPhase,
  type StepId,
} from "@/components/wizard/steps";
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

  const stepParam = single(params.step);
  const runIdParam = single(params.run);

  const [profile, sources, skills, products, runs] = await Promise.all([
    getCurrentProfile(product.id).catch(() => undefined),
    listSources(product.id).catch(() => []),
    availableSkills(undefined, product.id).catch(() => []),
    listProductsWithStatus().catch(() => []),
    listRunSummaries(product.id).catch(() => []),
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

  /*
   * A step is only offered once the product has the data it reads. That makes
   * the rail navigable backwards over real progress, and makes `?step=6` on a
   * product that never ran land on the last step that has something to show
   * rather than on an empty dashboard.
   */
  const furthest = furthestReachableStep({
    hasProfile: Boolean(profile),
    hasRun: Boolean(runId),
    hasLeads: leads.length > 0,
    hasMessages: messages.length > 0,
  });

  /*
   * An explicit `?step=` wins — it is what a refresh carries. Without one, this
   * is someone entering the run, so they land on the phase they left it at.
   * A product with no run yet opens on research if it has a profile to search
   * with, otherwise on the profile.
   */
  const resumeStep: StepId = run
    ? stepForPhase(run.phase)
    : profile
      ? 2
      : 1;
  const requestedStep = stepParam !== undefined ? clampStep(Number(stepParam)) : resumeStep;
  const step = Math.min(requestedStep, furthest) as StepId;

  const initial: WizardInitialState = {
    step,
    furthest,
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
    runs: runs.map((item) => ({
      id: item.id,
      status: item.status,
      phase: item.phase,
      targetCount: item.targetCount,
      leadCount: item.leadCount,
      messageCount: item.messageCount,
      sentCount: item.sentCount,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
    })),
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
  return Math.min(TOTAL_STEPS, Math.max(1, Math.round(value))) as StepId;
}
