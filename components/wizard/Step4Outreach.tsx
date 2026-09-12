"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import {
  Button,
  Card,
  Icon,
  Notice,
  Pill,
  RelevanceBadge,
  Spinner,
  inputClass,
} from "@/components/ui";
import { StepFrame } from "@/components/wizard/StepFrame";
import { readSse } from "@/components/readSse";

export type OutreachMessage = {
  id: string;
  leadId: string;
  subject: string;
  body: string;
  angle: { type: string; reason: string; benefit: string };
  critique: { pass: boolean; fixes: string[] } | null;
  status: string;
  error: string | null;
  sentAt: string | null;
};

export type GmailStatus = { configured: boolean; connectedEmail: string | null };

/** One step a lead's draft has been through, in the order it happened. */
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
export function Step4Outreach({
  productId,
  leads,
  selectedLeadIds,
  messages,
  gmail,
  onMessagesChange,
  onBack,
  onContinue,
}: {
  productId: string;
  leads: Lead[];
  selectedLeadIds: string[];
  messages: OutreachMessage[];
  gmail: GmailStatus;
  onMessagesChange: (messages: OutreachMessage[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  /**
   * What the graph has done and is doing, per lead. Drafting a batch is minutes
   * of model calls and a spinner says nothing for all of it — which is
   * indistinguishable from a hang, and the reason this step felt broken.
   */
  const [feed, setFeed] = useState<DraftProgress[]>([]);
  const requested = useRef(false);

  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const approved = selectedLeadIds.filter((id) => leadsById.has(id));

  const relevant = messages.filter(
    (message) => approved.includes(message.leadId) && !skipped.includes(message.id)
  );

  // Draft once on arrival, for any selected lead that has no message yet.
  useEffect(() => {
    if (requested.current) return;
    const missing = approved.filter(
      (leadId) => !messages.some((message) => message.leadId === leadId)
    );
    if (missing.length === 0) return;

    requested.current = true;
    setDrafting(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch("/api/outreach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: missing }),
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
                  total: Number(data.total ?? missing.length),
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
                        total: missing.length,
                        steps: [],
                        outcome,
                      },
                    ]
              );
              break;
            }

            case "done": {
              onMessagesChange(data.messages as OutreachMessage[]);
              const failures = (data.drafted as Array<{ error?: string }>).filter((i) => i.error);
              if (failures.length > 0) {
                setError(
                  `${failures.length} of ${missing.length} could not be drafted: ${failures[0].error}`
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
    })();
  }, [approved, messages, onMessagesChange]);

  function replace(next: OutreachMessage) {
    onMessagesChange(messages.map((message) => (message.id === next.id ? next : message)));
  }

  const sentCount = relevant.filter((message) => message.status === "sent").length;

  return (
    <StepFrame
      step={4}
      onBack={onBack}
      onContinue={onContinue}
      continueLabel="Go to dashboard"
      continueHint={
        sentCount > 0
          ? `${sentCount} sent`
          : relevant.length > 0
            ? "You can review these later"
            : undefined
      }
    >
      {/* Connection state is a fact about this step, so it sits at the top of it. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {!gmail.configured ? (
          <Pill tone="neutral" icon={<Icon.Warning className="h-3.5 w-3.5" />}>
            Gmail not configured on this deployment
          </Pill>
        ) : gmail.connectedEmail ? (
          <Pill tone="good" icon={<Icon.Check className="h-3.5 w-3.5" />}>
            Sending as {gmail.connectedEmail}
          </Pill>
        ) : (
          <>
            <Pill tone="warn" icon={<Icon.Warning className="h-3.5 w-3.5" />}>
              Gmail not connected
            </Pill>
            <a
              href={`/api/gmail/connect?productId=${productId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken"
            >
              <Icon.Mail className="h-3.5 w-3.5" />
              Connect Gmail
            </a>
          </>
        )}
        <span className="text-[13px] text-ink-3">Scope is send-only. Drafts are never sent automatically.</span>
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="bad">{error}</Notice>
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

      <div className="space-y-5">
        {relevant.map((message) => {
          const lead = leadsById.get(message.leadId);
          if (!lead) return null;
          return (
            <MessageCard
              key={message.id}
              message={message}
              lead={lead}
              canSend={gmail.configured && Boolean(gmail.connectedEmail)}
              onChanged={replace}
              onSkip={() => setSkipped((prev) => [...prev, message.id])}
            />
          );
        })}
      </div>

      {!drafting && relevant.length === 0 && !error && (
        <Card padding="lg">
          <p className="text-[15px] text-ink-2">
            No drafts to review. Go back to step three and select the leads you want to write to.
          </p>
        </Card>
      )}
    </StepFrame>
  );
}

/**
 * The live drafting feed.
 *
 * Rendered whenever drafting is happening, not only when there is nothing else
 * on screen: adding two leads to five existing drafts is still minutes of model
 * calls, and hiding the feed behind "no drafts yet" was most of why this step
 * looked like it had hung.
 */
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

function MessageCard({
  message,
  lead,
  canSend,
  onChanged,
  onSkip,
}: {
  message: OutreachMessage;
  lead: Lead;
  canSend: boolean;
  onChanged: (message: OutreachMessage) => void;
  onSkip: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sent = message.status === "sent";
  const blocker = !lead.email
    ? "This lead has no resolved email address."
    : !canSend
      ? "Connect a Gmail account to send."
      : null;

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/messages/${message.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, subject, body, send: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Approval failed");
      onChanged(data.message as OutreachMessage);
      setEditing(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="none">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ------------------------------------------------------- message */}
        <div className="min-w-0 p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone={sent ? "good" : message.status === "failed" ? "bad" : "neutral"}>
              {sent ? "Sent" : message.status === "failed" ? "Failed" : "Draft"}
            </Pill>
            <Pill tone="accent">{message.angle.type}</Pill>
            {message.critique && (
              <Pill tone={message.critique.pass ? "good" : "warn"}>
                {message.critique.pass
                  ? "Critique passed"
                  : `${message.critique.fixes.length} fix${message.critique.fixes.length === 1 ? "" : "es"} applied`}
              </Pill>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <input
                className={`${inputClass} font-medium`}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                aria-label="Subject"
              />
              <textarea
                className={`${inputClass} min-h-52 leading-relaxed`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                aria-label="Message body"
              />
            </div>
          ) : (
            <div className="rounded-[12px] border border-line bg-surface-sunken p-5">
              <p className="text-[15px] font-semibold text-ink">{subject}</p>
              <div className="mt-3 whitespace-pre-wrap text-[14px] leading-[1.7] text-ink-2">{body}</div>
            </div>
          )}

          {message.error && (
            <p className="mt-3 text-[13px] text-bad">{message.error}</p>
          )}
          {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!sent && (
              <>
                <Button
                  variant="primary"
                  onClick={approve}
                  disabled={busy || Boolean(blocker)}
                  title={blocker ?? undefined}
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <Icon.Check />}
                  Approve and send
                </Button>

                {editing ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSubject(message.subject);
                        setBody(message.body);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <span className="text-[13px] text-ink-3">Edits apply when you send.</span>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}

                <Button variant="ghost" onClick={onSkip}>
                  Skip
                </Button>
              </>
            )}

            {sent && (
              <p className="text-[13px] text-ink-3">
                Sent{message.sentAt ? ` ${new Date(message.sentAt).toLocaleString()}` : ""}
              </p>
            )}

            {blocker && !sent && <span className="text-[13px] text-ink-3">{blocker}</span>}
          </div>
        </div>

        {/* ------------------------------------------------------- context */}
        <aside className="border-t border-line bg-surface-sunken/60 p-6 lg:border-l lg:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight">{lead.fullName}</h3>
              {lead.company && <p className="mt-0.5 text-[13px] text-ink-2">{lead.company}</p>}
            </div>
          </div>

          <div className="mt-3">
            <RelevanceBadge value={lead.relevance} />
          </div>

          <div className="mt-5">
            <p className="section-number mb-1.5">SIGNAL</p>
            <p className="text-[13px] leading-relaxed text-ink">{lead.signal}</p>
          </div>

          <div className="mt-5">
            <p className="section-number mb-1.5">ANGLE</p>
            <p className="text-[13px] leading-relaxed text-ink-2">{message.angle.reason}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{message.angle.benefit}</p>
          </div>

          <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-[13px]">
            {lead.email ? (
              <p className="flex items-center gap-2 text-ink-2">
                <Icon.Mail className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 truncate">{lead.email}</span>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-ink-3">
                <Icon.Mail className="h-3.5 w-3.5 shrink-0" />
                No email resolved
              </p>
            )}
            {lead.profileUrl && (
              <a
                href={lead.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-ink-2 transition-colors hover:text-accent"
              >
                <Icon.External className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 truncate">Profile</span>
              </a>
            )}
          </div>
        </aside>
      </div>
    </Card>
  );
}
