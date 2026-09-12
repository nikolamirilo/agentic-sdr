"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/types";
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Icon,
  RelevanceBadge,
  Spinner,
} from "@/components/ui";
import { StepFrame, StickyBar } from "@/components/wizard/StepFrame";
import { useRunStream } from "@/components/useRunStream";

/**
 * The review surface for one run's leads.
 *
 * Still attached to the stream, because leads keep arriving while the loop
 * runs and this is where they land — but the loop's own transcript belongs to
 * the Research phase, not here. Nothing on this step stops or starts a run.
 */
export function Step3Leads({
  runId,
  targetCount,
  leads,
  onLeadsChange,
  selected,
  onSelectedChange,
  onBack,
  onContinue,
}: {
  runId: string | undefined;
  targetCount: number;
  leads: Lead[];
  /**
   * The leads this step fetches are what step four drafts against, so they are
   * owned by the wizard rather than by this component. Keeping them local here
   * is what left step four with nothing to write to.
   */
  onLeadsChange: (leads: Lead[]) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const stream = useRunStream(runId, targetCount);
  const [loading, setLoading] = useState(false);

  const running = Boolean(runId) && stream.status === "running";

  /*
   * The stream carries a trimmed lead card; the full record (criteria, evidence,
   * phone) comes from the API. Refetch when the count changes or the run ends,
   * rather than on every event.
   */
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/runs/${runId}/leads`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) onLeadsChange(data.leads as Lead[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // onLeadsChange is a setState, stable for the life of the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, stream.leads.length, stream.status]);

  const sorted = useMemo(
    () => [...leads].sort((a, b) => b.relevance - a.relevance),
    [leads]
  );

  const allSelected = sorted.length > 0 && selected.length === sorted.length;

  function toggle(id: string) {
    onSelectedChange(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    );
  }

  return (
    <StepFrame
      step={3}
      onBack={onBack}
      hideNav
      bottomInset={sorted.length > 0}
    >
      {/* ---------------------------------------------------------- leads */}
      {sorted.length === 0 ? (
        running ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Card key={index} padding="md">
                <div className="space-y-3">
                  <div className="shimmer h-5 w-48 rounded-[6px]" />
                  <div className="shimmer h-4 w-full rounded-[6px]" />
                  <div className="shimmer h-4 w-2/3 rounded-[6px]" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty title="No qualified leads yet">
            Nothing cleared the 60% bar. Go back and widen the ICP, lower a criterion weight, or
            raise the candidate budget so the loop has more to work with.
          </Empty>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-ink-2">
              <span className="tabular font-semibold text-ink">{sorted.length}</span> qualified
              {loading && <Spinner className="ml-2 inline h-3.5 w-3.5 text-ink-3" />}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSelectedChange(allSelected ? [] : sorted.map((lead) => lead.id))}
            >
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
          </div>

          <ul className="space-y-3">
            {sorted.map((lead) => (
              <li key={lead.id} className="row-in">
                <LeadCard
                  lead={lead}
                  checked={selected.includes(lead.id)}
                  onToggle={() => toggle(lead.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --------------------------------------------------- sticky action */}
      {sorted.length > 0 && (
        <StickyBar>
          <p className="text-[14px]">
            <span className="tabular font-semibold">{selected.length}</span>
            <span className="text-ink-2"> lead{selected.length === 1 ? "" : "s"} selected</span>
            {selected.length === 0 && (
              <span className="ml-2 text-[13px] text-ink-3">Select at least one to write to</span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={onBack} variant="ghost" size="lg">
              <Icon.ArrowLeft />
              Back
            </Button>
            <Button
              onClick={onContinue}
              variant="primary"
              size="lg"
              disabled={selected.length === 0}
            >
              Draft {selected.length > 0 ? selected.length : ""} message
              {selected.length === 1 ? "" : "s"}
              <Icon.ArrowRight />
            </Button>
          </div>
        </StickyBar>
      )}
    </StepFrame>
  );
}

function LeadCard({
  lead,
  checked,
  onToggle,
}: {
  lead: Lead;
  checked: boolean;
  onToggle: () => void;
}) {
  const [showCriteria, setShowCriteria] = useState(false);
  const met = lead.criteriaMet.filter((answer) => answer.met).length;

  return (
    <Card
      padding="none"
      className={`transition-colors duration-150 ${checked ? "border-accent-line bg-accent-tint/40" : ""}`}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="pt-0.5">
          <Checkbox checked={checked} onChange={onToggle} label={`Approve ${lead.fullName}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-tight text-ink">{lead.fullName}</h3>
              {lead.company && <p className="mt-0.5 text-[14px] text-ink-2">{lead.company}</p>}
            </div>
            <RelevanceBadge value={lead.relevance} />
          </div>

          {/* The one line that says why this person is here at all. */}
          <p className="mt-3 flex gap-2 text-[14px] leading-relaxed text-ink">
            <span className="section-number mt-[3px] shrink-0">SIGNAL</span>
            <span className="min-w-0">{lead.signal}</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-accent"
              >
                <Icon.Mail className="h-3.5 w-3.5" />
                {lead.email}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <Icon.Mail className="h-3.5 w-3.5" />
                No email resolved
              </span>
            )}

            {lead.phone && (
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Icon.Phone className="h-3.5 w-3.5" />
                {lead.phone}
              </span>
            )}

            {lead.profileUrl && (
              <a
                href={lead.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-accent"
              >
                <Icon.External className="h-3.5 w-3.5" />
                Profile
              </a>
            )}

            <button
              type="button"
              onClick={() => setShowCriteria((prev) => !prev)}
              aria-expanded={showCriteria}
              className="inline-flex items-center gap-1.5 text-ink-3 transition-colors hover:text-ink"
            >
              <Icon.Chevron className={`h-3.5 w-3.5 transition-transform ${showCriteria ? "rotate-180" : ""}`} />
              {met} of {lead.criteriaMet.length} criteria met
            </button>
          </div>

          {showCriteria && (
            <ul className="mt-4 space-y-2 border-t border-line pt-4">
              {lead.criteriaMet.map((answer) => (
                <li key={answer.id} className="flex gap-2.5 text-[13px]">
                  <span className={`mt-0.5 shrink-0 ${answer.met ? "text-good" : "text-ink-3"}`}>
                    {answer.met ? <Icon.Check className="h-3.5 w-3.5" /> : <Icon.Close className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={answer.met ? "text-ink" : "text-ink-3"}>{answer.question}</span>
                    <span className="section-number ml-2">W{answer.weight}</span>
                    <span className="mt-0.5 block leading-relaxed text-ink-3">{answer.evidence}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
