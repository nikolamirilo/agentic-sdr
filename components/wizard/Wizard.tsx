"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lead, ProductProfile, Skill } from "@/lib/types";
import { phaseForStep, type StepId } from "@/components/wizard/steps";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import {
  Step1Profile,
  type ProductSummary,
  type SourceSummary,
} from "@/components/wizard/Step1Profile";
import { Step2Research } from "@/components/wizard/Step2Research";
import { Step3Leads } from "@/components/wizard/Step3Leads";
import { Step4Comms } from "@/components/wizard/Step4Comms";
import {
  Step5Outreach,
  type GmailStatus,
  type OutreachMessage,
} from "@/components/wizard/Step5Outreach";
import { Step6Dashboard } from "@/components/wizard/Step6Dashboard";
import type { RunSummaryView } from "@/components/wizard/RunSwitcher";
import { Notice } from "@/components/ui";

export type WizardInitialState = {
  step: StepId;
  /** The last step this run has the data for; the rail locks past it. */
  furthest: StepId;
  product: ProductSummary;
  products: ProductSummary[];
  profile: ProductProfile | null;
  sources: SourceSummary[];
  skills: Skill[];
  runs: RunSummaryView[];
  runId: string | null;
  targetCount: number;
  leads: Lead[];
  messages: OutreachMessage[];
  gmail: GmailStatus;
  setupWarning: string | null;
};

/**
 * One product, one run at a time, one step on screen.
 *
 * Step transitions are local — they rewrite the URL with history.replaceState
 * rather than navigating, so moving between steps is instant. Moving between
 * the four run phases also records the phase on the run itself, which is what
 * makes reopening the run later land on the same screen: the URL only survives
 * a refresh, the stored phase survives everything else. Switching run is a real
 * navigation, handled by the run switcher.
 */
export function Wizard({ initial }: { initial: WizardInitialState }) {
  const productId = initial.product.id;

  const [step, setStep] = useState<StepId>(initial.step);
  /*
   * Seeded from what the run has already done rather than from the step being
   * shown, so the rail stays navigable after a refresh. `initial.step` is the
   * floor only because the server clamps it to this already — a step being
   * shown is by definition reachable.
   */
  const [furthest, setFurthest] = useState<StepId>(
    initial.furthest > initial.step ? initial.furthest : initial.step
  );

  const [profile, setProfile] = useState<ProductProfile | null>(initial.profile);
  const [runs, setRuns] = useState<RunSummaryView[]>(initial.runs);
  const [runId, setRunId] = useState<string | null>(initial.runId);
  const [targetCount, setTargetCount] = useState(initial.targetCount);
  const [leads, setLeads] = useState<Lead[]>(initial.leads);
  /*
   * Seeded from the drafts that already exist, so landing on a later phase after
   * a refresh shows the messages that were written rather than an empty step.
   */
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>(() =>
    Array.from(new Set(initial.messages.map((message) => message.leadId)))
  );
  const [messages, setMessages] = useState<OutreachMessage[]>(initial.messages);
  /** Bumped to remount Research straight onto its form. */
  const [newRunRequest, setNewRunRequest] = useState(0);

  /** Keeps the address bar honest without triggering a server round-trip. */
  const syncUrl = useCallback(
    (next: { step: StepId; runId?: string | null }) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams();
      params.set("step", String(next.step));
      const rid = next.runId !== undefined ? next.runId : runId;
      if (rid) params.set("run", rid);
      window.history.replaceState(null, "", `/admin/products/${productId}?${params.toString()}`);
    },
    [productId, runId]
  );

  /**
   * Stores where the user is in the run. Fire-and-forget: the screen has already
   * moved, and a lost write costs a resume position rather than any work.
   */
  const recordPhase = useCallback(
    (next: StepId, rid: string | null) => {
      const phase = phaseForStep(next);
      if (!phase || !rid) return;
      setRuns((prev) => prev.map((run) => (run.id === rid ? { ...run, phase } : run)));
      void fetch(`/api/runs/${rid}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase }),
      }).catch(() => {});
    },
    []
  );

  const goTo = useCallback(
    (next: StepId) => {
      setStep(next);
      setFurthest((prev) => (next > prev ? next : prev));
      syncUrl({ step: next });
      recordPhase(next, runId);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [syncUrl, recordPhase, runId]
  );

  /*
   * Returning from Google is a full page load, so `initial.gmail` is already the
   * fresh status. All this does is surface the result and strip the flag off the
   * URL so a refresh does not replay the message.
   */
  const [flash, setFlash] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const status = new URLSearchParams(window.location.search).get("gmail");
    if (!status) return;

    setFlash(
      status === "connected"
        ? { tone: "good", text: "Gmail connected. You can send from this account now." }
        : {
            tone: "bad",
            text:
              status === "no_refresh_token"
                ? "Google did not return a refresh token. Remove this app from your Google account permissions, then connect again."
                : status === "missing_scope"
                  ? "The send scope was not granted, so sending stays disabled."
                  : "Gmail could not be connected.",
          }
    );
    syncUrl({ step: initial.step });
  }, [initial.step, syncUrl]);

  /* --------------------------------------------------------- transitions */

  function handleRunStarted(newRunId: string, count: number) {
    setRunId(newRunId);
    setTargetCount(count);
    setSelectedLeadIds([]);
    setLeads([]);
    setMessages([]);
    setRuns((prev) => [
      {
        id: newRunId,
        status: "running",
        phase: "research",
        targetCount: count,
        leadCount: 0,
        messageCount: 0,
        sentCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
      ...prev.filter((run) => run.id !== newRunId),
    ]);
    /*
     * Stay on Research: that is the phase a fresh run is in, and it is where the
     * loop is watched now. Lead review opens straight away, since leads are
     * reviewable as they arrive. Down as well as up — a new run has none of the
     * last run's drafts, so the later phases have nothing to show yet.
     */
    setStep(2);
    setFurthest(3);
    syncUrl({ step: 2, runId: newRunId });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleNewRun() {
    setNewRunRequest((prev) => prev + 1);
    setStep(2);
    syncUrl({ step: 2 });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleEnterDashboard() {
    goTo(6);
    // Outcomes and message statuses change during outreach; reload before showing them.
    if (runId) {
      const response = await fetch(`/api/runs/${runId}/leads`).catch(() => null);
      if (response?.ok) {
        const data = await response.json();
        setLeads(data.leads as Lead[]);
      }
    }
  }

  return (
    <div className="min-h-screen">
      <StepIndicator
        current={step}
        furthest={furthest}
        onNavigate={goTo}
        product={initial.product}
        products={initial.products}
        runs={runs}
        runId={runId}
      />

      <main className="mx-auto w-full max-w-[76rem] px-6 py-12 lg:px-10 lg:py-16">
        {initial.setupWarning && (
          <div className="mb-8">
            <Notice tone="warn" title="Setup incomplete">
              {initial.setupWarning}
            </Notice>
          </div>
        )}

        {flash && (
          <div className="mb-8">
            <Notice tone={flash.tone === "good" ? "good" : "bad"}>{flash.text}</Notice>
          </div>
        )}

        {step === 1 && (
          <Step1Profile
            productId={productId}
            profile={profile}
            sources={initial.sources}
            onProfileChanged={setProfile}
            onContinue={() => goTo(2)}
          />
        )}

        {step === 2 && (
          <Step2Research
            key={newRunRequest}
            productId={productId}
            profile={profile}
            skills={initial.skills}
            runId={runId ?? undefined}
            targetCount={targetCount}
            runs={runs}
            startConfiguring={newRunRequest > 0}
            onBack={() => goTo(1)}
            onStarted={handleRunStarted}
            onContinue={() => goTo(3)}
          />
        )}

        {step === 3 && (
          <Step3Leads
            runId={runId ?? undefined}
            targetCount={targetCount}
            leads={leads}
            onLeadsChange={setLeads}
            selected={selectedLeadIds}
            onSelectedChange={setSelectedLeadIds}
            onBack={() => goTo(2)}
            onContinue={() => goTo(4)}
          />
        )}

        {step === 4 && (
          <Step4Comms
            leads={leads}
            selectedLeadIds={selectedLeadIds}
            messages={messages}
            onMessagesChange={setMessages}
            onBack={() => goTo(3)}
            onContinue={() => goTo(5)}
          />
        )}

        {step === 5 && (
          <Step5Outreach
            productId={productId}
            runId={runId}
            leads={leads}
            selectedLeadIds={selectedLeadIds}
            messages={messages}
            gmail={initial.gmail}
            onMessagesChange={setMessages}
            onBack={() => goTo(4)}
            onContinue={handleEnterDashboard}
          />
        )}

        {step === 6 && (
          <Step6Dashboard
            leads={leads}
            messages={messages}
            onLeadsChange={setLeads}
            onBack={() => goTo(5)}
            onNewRun={handleNewRun}
          />
        )}
      </main>
    </div>
  );
}
