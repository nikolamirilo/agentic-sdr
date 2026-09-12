"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lead, ProductProfile, Skill } from "@/lib/types";
import type { StepId } from "@/components/wizard/steps";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import {
  Step1Profile,
  type ProductSummary,
  type SourceSummary,
} from "@/components/wizard/Step1Profile";
import { Step2Research } from "@/components/wizard/Step2Research";
import { Step3Leads } from "@/components/wizard/Step3Leads";
import {
  Step4Outreach,
  type GmailStatus,
  type OutreachMessage,
} from "@/components/wizard/Step4Outreach";
import { Step5Dashboard } from "@/components/wizard/Step5Dashboard";
import { Notice } from "@/components/ui";

export type WizardInitialState = {
  step: StepId;
  /** The last step this product has the data for; the rail locks past it. */
  furthest: StepId;
  product: ProductSummary;
  products: ProductSummary[];
  profile: ProductProfile | null;
  sources: SourceSummary[];
  skills: Skill[];
  runId: string | null;
  targetCount: number;
  leads: Lead[];
  messages: OutreachMessage[];
  gmail: GmailStatus;
  setupWarning: string | null;
};

/**
 * One product, one flow, one step on screen at a time.
 *
 * Step transitions are local — they rewrite the URL with history.replaceState
 * rather than navigating, so moving between steps is instant and a refresh
 * still lands on the step you were on. Data changes go through the API and
 * update local state; the server component only runs on a cold load.
 */
export function Wizard({ initial }: { initial: WizardInitialState }) {
  const productId = initial.product.id;

  const [step, setStep] = useState<StepId>(initial.step);
  /*
   * Seeded from what the product has already done rather than from the step
   * being shown, so the rail stays navigable after a refresh. `initial.step` is
   * the floor only because the server clamps it to this already — a step being
   * shown is by definition reachable.
   */
  const [furthest, setFurthest] = useState<StepId>(
    initial.furthest > initial.step ? initial.furthest : initial.step
  );

  const [profile, setProfile] = useState<ProductProfile | null>(initial.profile);
  // Skills are editable from step two, so they live here rather than on props.
  const [runId, setRunId] = useState<string | null>(initial.runId);
  const [targetCount, setTargetCount] = useState(initial.targetCount);
  const [leads, setLeads] = useState<Lead[]>(initial.leads);
  /*
   * Seeded from the drafts that already exist, so landing on step four after a
   * refresh shows the messages that were written rather than an empty step.
   */
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>(() =>
    Array.from(new Set(initial.messages.map((message) => message.leadId)))
  );
  const [messages, setMessages] = useState<OutreachMessage[]>(initial.messages);

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

  const goTo = useCallback(
    (next: StepId) => {
      setStep(next);
      setFurthest((prev) => (next > prev ? next : prev));
      syncUrl({ step: next });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [syncUrl]
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
    setStep(3);
    /*
     * Down as well as up. A new run drops the leads and drafts the last one
     * produced, so the later steps have nothing to show until this run gets
     * there — leaving them open would hand back the empty step the rail exists
     * to keep out of reach.
     */
    setFurthest(3);
    syncUrl({ step: 3, runId: newRunId });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleEnterDashboard() {
    goTo(5);
    // Outcomes and message statuses change on step four; reload before showing them.
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
            productId={productId}
            profile={profile}
            skills={initial.skills}
            onBack={() => goTo(1)}
            onStarted={handleRunStarted}
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
          <Step4Outreach
            productId={productId}
            leads={leads}
            selectedLeadIds={selectedLeadIds}
            messages={messages}
            gmail={initial.gmail}
            onMessagesChange={setMessages}
            onBack={() => goTo(3)}
            onContinue={handleEnterDashboard}
          />
        )}

        {step === 5 && (
          <Step5Dashboard
            leads={leads}
            messages={messages}
            onLeadsChange={setLeads}
            onBack={() => goTo(4)}
            onNewRun={() => goTo(2)}
          />
        )}
      </main>
    </div>
  );
}
