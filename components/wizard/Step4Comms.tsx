"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { Button, Card, Icon, Notice, Pill, Spinner } from "@/components/ui";
import { StepFrame } from "@/components/wizard/StepFrame";
import { readSse } from "@/components/readSse";
import type { OutreachMessage } from "@/components/wizard/Step5Outreach";

type DraftStep = {
  node: string;
  label: string;
  summary: string;
};

/**
 * One lead's drafting progress.
 *
 * The steps are kept as a list rather than one replaced line. Watching profile
 * generation tells you both what the graph is doing now and what it already
 * did; a single line that gets overwritten tells you neither, which is why this
 * step felt like a spinner even though the graph was narrating the whole time.
 */
type DraftProgress = {
  leadId: string;
  leadName: string;
  index: number;
  total: number;
  steps: DraftStep[];
  /** Set once the lead reaches a terminal state. */
  outcome?: { label: string; failed: boolean; detail: string };
};

/** Newly drafted messages win; everything else on screen is kept. */
function merge(prev: OutreachMessage[], incoming: OutreachMessage[]): OutreachMessage[] {
  const ids = new Set(incoming.map((message) => message.id));
  const leadIds = new Set(incoming.map((message) => message.leadId));
  return [
    ...incoming,
    ...prev.filter((message) => !ids.has(message.id) && !leadIds.has(message.leadId)),
  ];
}

/** One line per node, so a repeated node updates rather than piles up. */
function upsertStep(steps: DraftStep[], step: DraftStep): DraftStep[] {
  const at = steps.findIndex((s) => s.node === step.node);
  if (at === -1) return [...steps, step];
  const next = [...steps];
  next[at] = step;
  return next;
}

/**
 * Nothing on this step sends on its own. Each draft waits on a LangGraph
 * interrupt with its state in Postgres, and approving is what resumes the graph
 * at its send node.
 */

/**
 * Communication Generation.
 *
 * One graph run per approved lead, each deciding its own angle from that lead's
 * evidence before a word is written. Every graph stops at its approval
 * interrupt with its state in the checkpointer, so nothing here can send —
 * sending is the next phase, and it is a separate decision.
 */
export function Step4Comms({
  leads,
  selectedLeadIds,
  messages,
  onMessagesChange,
  onBack,
  onContinue,
}: {
  leads: Lead[];
  selectedLeadIds: string[];
  messages: OutreachMessage[];
  /** Accepts an updater so a second drafting batch can merge with the first. */
  onMessagesChange: (
    messages: OutreachMessage[] | ((prev: OutreachMessage[]) => OutreachMessage[])
  ) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  /**
   * What the graph has done and is doing, per lead. Drafting a batch is minutes
   * of model calls and a spinner says nothing for all of it — which is
   * indistinguishable from a hang.
   */
  const [feed, setFeed] = useState<DraftProgress[]>([]);
  /**
   * The leads drafting has already been asked for. A set rather than a single
   * flag: leads can arrive after this step mounts, and a boolean would either
   * fire the request before they are there or never fire it again afterwards.
   */
  const attempted = useRef(new Set<string>());

  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const approved = selectedLeadIds.filter((id) => leadsById.has(id));

  const drafted = approved.filter((leadId) =>
    messages.some((message) => message.leadId === leadId)
  );
  const undrafted = approved.filter(
    (leadId) => !messages.some((message) => message.leadId === leadId)
  );

  const draftFor = useCallback(
    async (leadIds: string[]) => {
      if (leadIds.length === 0) return;
      for (const leadId of leadIds) attempted.current.add(leadId);

      setDrafting(true);
      setError("");

      try {
        const response = await fetch("/api/outreach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `Drafting failed (${response.status})`);
        }

        await readSse(response, (event, data) => {
          const leadId = String(data.leadId ?? "");

          switch (event) {
            case "lead_start":
              setFeed((prev) => [
                ...prev.filter((line) => line.leadId !== leadId),
                {
                  leadId,
                  leadName: String(data.leadName ?? "lead"),
                  index: Number(data.index ?? prev.length + 1),
                  total: Number(data.total ?? leadIds.length),
                  steps: [],
                },
              ]);
              break;

            case "node":
              // Every node the graph reports becomes its own line, so the card
              // reads as a trail: angle decided, draft written, critique run.
              setFeed((prev) =>
                prev.map((line) =>
                  line.leadId === leadId
                    ? {
                        ...line,
                        steps: upsertStep(line.steps, {
                          node: String(data.node),
                          label: String(data.label ?? data.node),
                          summary: String(data.summary ?? ""),
                        }),
                      }
                    : line
                )
              );
              break;

            case "lead_done":
            case "lead_error": {
              const outcome = {
                label: event === "lead_error" ? "Could not draft" : "Ready for review",
                failed: event === "lead_error",
                detail: String(data.error ?? ""),
              };
              setFeed((prev) =>
                // A lead that never started — one that could not be loaded —
                // has no card yet, and its failure is the thing worth showing.
                prev.some((line) => line.leadId === leadId)
                  ? prev.map((line) => (line.leadId === leadId ? { ...line, outcome } : line))
                  : [
                      ...prev,
                      {
                        leadId,
                        leadName: String(data.leadName ?? "lead"),
                        index: prev.length + 1,
                        total: leadIds.length,
                        steps: [],
                        outcome,
                      },
                    ]
              );
              break;
            }

            case "done": {
              // Merge, not replace: this frame only carries the batch that was
              // just drafted, and replacing would drop every earlier draft.
              onMessagesChange((prev) => merge(prev, data.messages as OutreachMessage[]));
              const failures = (data.drafted as Array<{ error?: string }>).filter((i) => i.error);
              if (failures.length > 0) {
                setError(
                  `${failures.length} of ${leadIds.length} could not be drafted: ${failures[0].error}`
                );
              }
              break;
            }

            case "error":
              throw new Error(String(data.message ?? "Drafting failed"));
          }
        });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setDrafting(false);
      }
    },
    [onMessagesChange]
  );

  /**
   * Drafting starts on its own, for every approved lead that has no message yet.
   * Keyed on the lead ids rather than run once on mount: the leads this step
   * draws on are fetched on the review step, so an empty first render is normal.
   */
  const pending = undrafted.filter((leadId) => !attempted.current.has(leadId));
  const pendingKey = pending.join(",");

  useEffect(() => {
    if (drafting || pendingKey === "") return;
    void draftFor(pendingKey.split(","));
    // pendingKey is the identity of the batch; the array itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, drafting]);

  /** Lets a failed batch be asked for again; `attempted` would otherwise block it. */
  function retry() {
    for (const leadId of undrafted) attempted.current.delete(leadId);
    setFeed([]);
    setError("");
  }

  return (
    <StepFrame
      step={4}
      onBack={onBack}
      onContinue={drafted.length > 0 ? onContinue : undefined}
      continueLabel={`Review ${drafted.length} draft${drafted.length === 1 ? "" : "s"}`}
      continueDisabled={drafting}
      continueHint={
        drafting
          ? "Still writing"
          : undrafted.length > 0
            ? `${undrafted.length} still without a draft`
            : undefined
      }
    >
      {approved.length === 0 ? (
        <Card padding="lg">
          <p className="text-[15px] text-ink-2">
            No leads approved yet. Go back to Lead Review and select the ones you want to write to.
          </p>
        </Card>
      ) : (
        <>
          {error && (
            <div className="mb-6 space-y-3">
              <Notice tone="bad">{error}</Notice>
              {!drafting && undrafted.length > 0 && (
                <Button variant="secondary" onClick={retry}>
                  Try again
                </Button>
              )}
            </div>
          )}

          {drafting && (
            <div className="mb-6">
              <DraftingFeed
                feed={feed}
                queued={approved
                  .filter(
                    (leadId) =>
                      !messages.some((message) => message.leadId === leadId) &&
                      !feed.some((line) => line.leadId === leadId)
                  )
                  .map((leadId) => ({
                    leadId,
                    leadName: leadsById.get(leadId)?.fullName ?? "lead",
                  }))}
              />
            </div>
          )}

          {/*
            What this phase produced, once it is idle. Subject lines only: the
            body, the evidence behind it and the send controls are the next
            phase, and putting them here would make the two the same screen
            again.
          */}
          {!drafting && drafted.length > 0 && (
            <div className="space-y-3">
              <p className="text-[14px] text-ink-2">
                <span className="tabular font-semibold text-ink">{drafted.length}</span> draft
                {drafted.length === 1 ? "" : "s"} written, none sent.
              </p>
              <ul className="space-y-3">
                {drafted.map((leadId) => {
                  const lead = leadsById.get(leadId)!;
                  const message = messages.find((item) => item.leadId === leadId)!;
                  return (
                    <li key={leadId} className="row-in">
                      <Card padding="md">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-ink">{lead.fullName}</p>
                            <p className="mt-0.5 truncate text-[14px] text-ink-2">
                              {message.subject}
                            </p>
                          </div>
                          <Pill tone={message.status === "sent" ? "good" : "neutral"}>
                            {message.status === "sent" ? "Sent" : "Ready for review"}
                          </Pill>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/*
            Undrafted leads with drafting idle means the automatic pass did not
            cover them — a batch that failed, or leads selected after it ran.
          */}
          {!drafting && !error && undrafted.length > 0 && (
            <Card padding="lg" className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-[15px] text-ink-2">
                  {undrafted.length} approved lead{undrafted.length === 1 ? " has" : "s have"} no
                  draft yet.
                </p>
                <Button variant="primary" onClick={retry}>
                  <Icon.Spark />
                  Write {undrafted.length} message{undrafted.length === 1 ? "" : "s"}
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </StepFrame>
  );
}

function DraftingFeed({
  feed,
  queued,
}: {
  feed: DraftProgress[];
  queued: Array<{ leadId: string; leadName: string }>;
}) {
  const total = feed.length + queued.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Spinner className="h-4 w-4 text-accent" />
        <p className="text-[15px] font-medium">
          Writing {total} message{total === 1 ? "" : "s"}
        </p>
        <span className="text-[13px] text-ink-3">
          A minute or so each. Every draft stops for your approval before it can be sent.
        </span>
      </div>

      {feed.map((lead) => (
        <LeadProgressCard key={lead.leadId} lead={lead} />
      ))}

      {queued.map((lead) => (
        <Card key={lead.leadId} padding="md">
          <div className="flex items-center gap-3">
            <p className="text-[15px] font-medium text-ink-2">{lead.leadName}</p>
            <Pill tone="neutral">Queued</Pill>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** One lead: the steps its draft has been through, and where it is now. */
function LeadProgressCard({ lead }: { lead: DraftProgress }) {
  const finished = Boolean(lead.outcome);

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-center gap-3">
        {!finished ? (
          <Spinner className="h-4 w-4 shrink-0 text-accent" />
        ) : lead.outcome!.failed ? (
          <Icon.Warning className="h-4 w-4 shrink-0 text-bad" />
        ) : (
          <Icon.Check className="h-4 w-4 shrink-0 text-accent" />
        )}
        <p className="text-[15px] font-medium">{lead.leadName}</p>
        {lead.total > 0 && (
          <span className="text-[13px] text-ink-3">
            lead {lead.index} of {lead.total}
          </span>
        )}
        <span className="ml-auto">
          <Pill tone={finished ? (lead.outcome!.failed ? "bad" : "good") : "neutral"}>
            {lead.outcome?.label ?? lead.steps.at(-1)?.label ?? "Starting"}
          </Pill>
        </span>
      </div>

      {lead.outcome?.detail && (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{lead.outcome.detail}</p>
      )}

      <ol className="mt-4">
        {lead.steps.map((step, index) => {
          // The last step is the one still running, until the lead is finished.
          const active = !finished && index === lead.steps.length - 1;
          return (
            <li key={step.node} className="row-in border-b border-line py-2.5 last:border-0">
              <div className="flex items-baseline gap-3">
                {active ? (
                  <Spinner className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />
                ) : (
                  <Icon.Check className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />
                )}
                <span className="min-w-0 flex-1 text-[14px] font-medium">{step.label}</span>
              </div>
              {step.summary && (
                <p className="mt-1 pl-7 text-[13px] leading-relaxed text-ink-2">{step.summary}</p>
              )}
            </li>
          );
        })}

        {lead.steps.length === 0 && !finished && (
          <li className="space-y-2 py-2">
            <div className="shimmer h-4 w-2/3 rounded-[6px]" />
            <div className="shimmer h-4 w-1/2 rounded-[6px]" />
          </li>
        )}
      </ol>
    </Card>
  );
}
