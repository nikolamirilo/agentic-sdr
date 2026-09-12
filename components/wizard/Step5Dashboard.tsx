"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/types";
import type { OutreachMessage } from "@/components/wizard/Step4Outreach";
import { Button, Card, Empty, Icon, Pill, RelevanceBadge } from "@/components/ui";
import { StepFrame } from "@/components/wizard/StepFrame";

const OUTCOMES = [
  { value: "not_contacted", label: "Not Contacted", tone: "neutral" as const },
  { value: "contacted", label: "Contacted", tone: "info" as const },
  { value: "replied", label: "Replied", tone: "warn" as const },
  { value: "meeting_booked", label: "Meeting Booked", tone: "good" as const },
];

/** Rank for sorting: furthest through the funnel first. */
const OUTCOME_RANK = new Map(OUTCOMES.map((outcome, index) => [outcome.value, index]));

type SortKey = "relevance" | "outcome";

/**
 * The end of the flow rather than another form. No Continue button, no fields to
 * fill in — this is the record of what the run produced and where each lead got
 * to, and it is the screen you come back to.
 */
export function Step5Dashboard({
  leads,
  messages,
  onLeadsChange,
  onBack,
  onNewRun,
}: {
  leads: Lead[];
  messages: OutreachMessage[];
  onLeadsChange: (leads: Lead[]) => void;
  onBack: () => void;
  onNewRun: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [descending, setDescending] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  // The API returns messages newest first, so the first one seen per lead wins.
  const messageByLead = useMemo(() => {
    const map = new Map<string, OutreachMessage>();
    for (const message of messages) {
      if (!map.has(message.leadId)) map.set(message.leadId, message);
    }
    return map;
  }, [messages]);

  const sorted = useMemo(() => {
    const direction = descending ? -1 : 1;
    return [...leads].sort((a, b) => {
      if (sortKey === "relevance") return (a.relevance - b.relevance) * direction;
      const rankA = OUTCOME_RANK.get(a.outcome) ?? 0;
      const rankB = OUTCOME_RANK.get(b.outcome) ?? 0;
      if (rankA !== rankB) return (rankA - rankB) * direction;
      return (a.relevance - b.relevance) * -1;
    });
  }, [leads, sortKey, descending]);

  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) counts.set(lead.outcome, (counts.get(lead.outcome) ?? 0) + 1);
    return counts;
  }, [leads]);

  async function updateOutcome(leadId: string, outcome: string) {
    setPending(leadId);
    // Optimistic: the row moves immediately and reverts if the write fails.
    const previous = leads;
    onLeadsChange(leads.map((lead) => (lead.id === leadId ? { ...lead, outcome } : lead)));
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!response.ok) throw new Error("write failed");
    } catch {
      onLeadsChange(previous);
    } finally {
      setPending(null);
    }
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDescending((prev) => !prev);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <StepFrame step={5} onBack={onBack} hideNav>
      {/* ---------------------------------------------------------- stats */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Qualified leads" value={leads.length} emphasis />
        {OUTCOMES.slice(1).map((outcome) => (
          <StatTile
            key={outcome.value}
            label={outcome.label}
            value={stats.get(outcome.value) ?? 0}
            tone={outcome.tone}
          />
        ))}
      </div>

      {leads.length === 0 ? (
        <Empty title="Nothing here yet">
          Run research from step two and approve some leads. They land here with their outcome, and
          this is where you track what came back.
        </Empty>
      ) : (
        <Card padding="none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
            <h2 className="text-[15px] font-semibold">All leads</h2>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[13px] text-ink-3">Sort by</span>
              {(["relevance", "outcome"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSort(key)}
                  aria-pressed={sortKey === key}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium capitalize transition-colors ${
                    sortKey === key
                      ? "bg-accent-tint text-accent"
                      : "text-ink-2 hover:bg-surface-sunken hover:text-ink"
                  }`}
                >
                  {key}
                  {sortKey === key && (
                    <Icon.Chevron
                      className={`h-3.5 w-3.5 transition-transform ${descending ? "" : "rotate-180"}`}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Lead", "Signal", "Relevance", "Message", "Outcome"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-6 py-3 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((lead) => {
                  const message = messageByLead.get(lead.id);
                  return (
                    <tr key={lead.id} className="border-b border-line last:border-0 hover:bg-surface-sunken/60">
                      <td className="px-6 py-4 align-top">
                        <p className="text-[14px] font-medium leading-tight text-ink">{lead.fullName}</p>
                        {lead.company && <p className="mt-0.5 text-[13px] text-ink-2">{lead.company}</p>}
                        {lead.email && (
                          <p className="mt-1 truncate text-[12px] text-ink-3">{lead.email}</p>
                        )}
                      </td>
                      <td className="max-w-xs px-6 py-4 align-top text-[13px] leading-relaxed text-ink-2">
                        {lead.signal}
                      </td>
                      <td className="px-6 py-4 align-top">
                        <RelevanceBadge value={lead.relevance} />
                      </td>
                      <td className="px-6 py-4 align-top">
                        {message ? (
                          <Pill
                            tone={
                              message.status === "sent"
                                ? "good"
                                : message.status === "failed"
                                  ? "bad"
                                  : message.status === "approved"
                                    ? "accent"
                                    : "neutral"
                            }
                          >
                            {message.status === "sent"
                              ? "Sent"
                              : message.status === "failed"
                                ? "Failed"
                                : message.status === "approved"
                                  ? "Approved"
                                  : "Draft"}
                          </Pill>
                        ) : (
                          <span className="text-[13px] text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 align-top">
                        <OutcomeSelect
                          value={lead.outcome}
                          busy={pending === lead.id}
                          onChange={(outcome) => updateOutcome(lead.id, outcome)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-8">
        <Button onClick={onBack} variant="ghost" size="lg">
          <Icon.ArrowLeft />
          Back to outreach
        </Button>
        <Button onClick={onNewRun} variant="primary" size="lg">
          <Icon.Search />
          Start another run
        </Button>
      </footer>
    </StepFrame>
  );
}

function StatTile({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "info";
  emphasis?: boolean;
}) {
  const accent = {
    neutral: "text-ink",
    good: "text-good",
    warn: "text-warn",
    info: "text-info",
  }[tone ?? "neutral"];

  return (
    <div
      className={`rounded-[14px] border px-5 py-4 ${
        emphasis ? "border-accent-line bg-accent-tint" : "border-line bg-surface"
      }`}
    >
      <p className={`tabular text-[28px] font-semibold leading-none ${emphasis ? "text-accent" : accent}`}>
        {value}
      </p>
      <p className="mt-2 text-[13px] text-ink-2">{label}</p>
    </div>
  );
}

/** A native select, restyled. Keyboard behaviour beats a custom popover here. */
function OutcomeSelect({
  value,
  busy,
  onChange,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  const current = OUTCOMES.find((outcome) => outcome.value === value) ?? OUTCOMES[0];

  return (
    <div className="relative inline-flex items-center">
      <Pill tone={current.tone}>{current.label}</Pill>
      <Icon.Chevron className="pointer-events-none ml-1 h-3.5 w-3.5 text-ink-3" />
      <select
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Outcome"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {OUTCOMES.map((outcome) => (
          <option key={outcome.value} value={outcome.value}>
            {outcome.label}
          </option>
        ))}
      </select>
    </div>
  );
}
