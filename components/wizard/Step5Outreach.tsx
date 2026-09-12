"use client";

import { useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import type { Lead } from "@/lib/types";
import {
  Button,
  Card,
  Icon,
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

/**
 * Outreach: the last thing between a draft and somebody's inbox.
 *
 * Nothing on this step sends on its own. Each draft is still parked on a
 * LangGraph interrupt with its state in Postgres, and approving is what resumes
 * that graph at its send node — which is why this is its own phase rather than
 * the back half of the one that wrote them.
 */
export function Step5Outreach({
  productId,
  runId,
  leads,
  selectedLeadIds,
  messages,
  gmail,
  onMessagesChange,
  onBack,
  onContinue,
}: {
  productId: string;
  /** So returning from Google lands back on this run, not the latest one. */
  runId: string | null;
  leads: Lead[];
  selectedLeadIds: string[];
  messages: OutreachMessage[];
  gmail: GmailStatus;
  onMessagesChange: (
    messages: OutreachMessage[] | ((prev: OutreachMessage[]) => OutreachMessage[])
  ) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);

  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const approved = selectedLeadIds.filter((id) => leadsById.has(id));

  /*
   * One card per lead: a re-drafted lead has more than one message row, and
   * `listMessagesForLeads` returns them newest first.
   */
  const relevant = messages
    .filter((message) => approved.includes(message.leadId) && !skipped.includes(message.id))
    .filter(
      (message, index, all) => all.findIndex((other) => other.leadId === message.leadId) === index
    );

  const undrafted = approved.filter(
    (leadId) => !messages.some((message) => message.leadId === leadId)
  );

  function replace(next: OutreachMessage) {
    onMessagesChange((prev) => prev.map((message) => (message.id === next.id ? next : message)));
  }

  /**
   * A re-drafted lead gets a new message row on a new graph thread. The fresh
   * rows go first, so the one-card-per-lead filter above picks them up; the old
   * draft stays in history underneath.
   */
  function addDrafts(incoming: OutreachMessage[]) {
    const ids = new Set(incoming.map((message) => message.id));
    onMessagesChange((prev) => [...incoming, ...prev.filter((message) => !ids.has(message.id))]);
  }

  const sentCount = relevant.filter((message) => message.status === "sent").length;

  return (
    <StepFrame
      step={5}
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
              href={`/api/gmail/connect?productId=${productId}&from=${encodeURIComponent(
                `/admin/products/${productId}?step=5${runId ? `&run=${runId}` : ""}`
              )}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken"
            >
              <Icon.Mail className="h-3.5 w-3.5" />
              Connect Gmail
            </a>
          </>
        )}
        <span className="text-[13px] text-ink-3">
          {gmail.configured && gmail.connectedEmail
            ? "Scope is send-only. Drafts are never sent automatically."
            : "Drafts are reviewed here either way. Connect Gmail to send them from the app; until then you can copy them out."}
        </span>
      </div>

      <div className="space-y-5">
        {relevant.map((message) => {
          const lead = leadsById.get(message.leadId);
          if (!lead) return null;
          return (
            <MessageCard
              key={message.id}
              message={message}
              lead={lead}
              productId={productId}
              canSend={gmail.configured && Boolean(gmail.connectedEmail)}
              onChanged={replace}
              onRegenerated={addDrafts}
              onSkip={() => setSkipped((prev) => [...prev, message.id])}
            />
          );
        })}
      </div>

      {/* Writing is the previous phase's job, so this sends you back to it. */}
      {undrafted.length > 0 && (
        <Card padding="lg" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[15px] text-ink-2">
              {undrafted.length} approved lead{undrafted.length === 1 ? " has" : "s have"} no draft
              yet.
            </p>
            <Button variant="secondary" onClick={onBack}>
              <Icon.ArrowLeft />
              Back to generation
            </Button>
          </div>
        </Card>
      )}

      {relevant.length === 0 && undrafted.length === 0 && (
        <Card padding="lg">
          <p className="text-[15px] text-ink-2">
            No drafts to review. Go back to Lead Review and select the leads you want to write to.
          </p>
        </Card>
      )}
    </StepFrame>
  );
}


/**
 * A draft is reviewable whether or not Gmail is connected. Sending is the only
 * thing the connector gates: without it the draft is still written, still
 * editable, still approvable, and can be copied out and sent by hand.
 */
function MessageCard({
  message,
  lead,
  productId,
  canSend,
  onChanged,
  onRegenerated,
  onSkip,
}: {
  message: OutreachMessage;
  lead: Lead;
  productId: string;
  canSend: boolean;
  onChanged: (message: OutreachMessage) => void;
  onRegenerated: (messages: OutreachMessage[]) => void;
  onSkip: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  /** The node the re-draft is on, or null when not regenerating. */
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const sent = message.status === "sent";
  const isApproved = message.status === "approved";
  const sendable = canSend && Boolean(lead.email);
  const blocker = !lead.email
    ? "This lead has no resolved email address, so it can only be copied out."
    : !canSend
      ? "Gmail is not connected, so sending from here is off."
      : null;

  /** `send: false` records the decision without waking the graph's send node. */
  async function approve(send: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/messages/${message.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, subject, body, send }),
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

  /**
   * Runs the outreach graph again for this one lead on a fresh thread. The new
   * draft replaces this card when it lands, which also discards unsaved edits.
   */
  async function regenerate() {
    setRegenerating("Starting");
    setError("");
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [lead.id] }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Re-generating failed (${response.status})`);
      }

      let incoming: OutreachMessage[] = [];
      await readSse(response, (event, data) => {
        switch (event) {
          case "node":
            setRegenerating(String(data.label ?? data.node));
            break;
          case "lead_error":
            throw new Error(String(data.error ?? "Could not draft"));
          case "error":
            throw new Error(String(data.message ?? "Re-generating failed"));
          case "done":
            incoming = data.messages as OutreachMessage[];
            break;
        }
      });

      // Newest first, so the first row for this lead is the one just written.
      const fresh = incoming.find((item) => item.leadId === lead.id);
      if (!fresh || fresh.id === message.id) throw new Error("No new draft came back");
      onRegenerated(incoming);
    } catch (caught) {
      setError((caught as Error).message);
      setRegenerating(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser would not give access to the clipboard.");
    }
  }

  return (
    <Card padding="none">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ------------------------------------------------------- message */}
        <div className="min-w-0 p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill
              tone={
                sent ? "good" : message.status === "failed" ? "bad" : isApproved ? "accent" : "neutral"
              }
            >
              {sent ? "Sent" : message.status === "failed" ? "Failed" : isApproved ? "Approved" : "Draft"}
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
                {sendable ? (
                  <Button variant="primary" onClick={() => approve(true)} disabled={busy}>
                    {busy ? <Spinner className="h-4 w-4" /> : <Icon.Mail />}
                    {isApproved ? "Send now" : "Approve and send"}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => approve(false)}
                    disabled={busy || isApproved}
                    title={blocker ?? undefined}
                  >
                    {busy ? <Spinner className="h-4 w-4" /> : <Icon.Check />}
                    {isApproved ? "Approved" : "Approve draft"}
                  </Button>
                )}

                <Button variant="secondary" onClick={copy}>
                  <Icon.Document />
                  {copied ? "Copied" : "Copy"}
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

                <Button
                  variant="secondary"
                  onClick={regenerate}
                  disabled={busy || regenerating !== null}
                  title="Write this email again from scratch"
                >
                  {regenerating ? <Spinner className="h-4 w-4" /> : <Icon.Spark />}
                  {regenerating ? `${regenerating}…` : "Re-generate"}
                </Button>

                <Button variant="ghost" onClick={onSkip}>
                  Skip
                </Button>
              </>
            )}

            {sent && (
              <p className="text-[13px] text-ink-3">
                Sent{message.sentAt ? <> <LocalTime iso={message.sentAt} /></> : ""}
              </p>
            )}

            {blocker && !sent && (
              <span className="flex items-center gap-2 text-[13px] text-ink-3">
                {blocker}
                {!canSend && lead.email && (
                  <a
                    href={`/api/gmail/connect?productId=${productId}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Connect Gmail
                  </a>
                )}
              </span>
            )}
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

          {/*
            The three parameters the angle node derived from the profile and the
            lead's signal. Named rather than run together, because they are what
            the operator is actually reviewing when they read the draft.
          */}
          <div className="mt-5 space-y-3">
            <div>
              <p className="section-number mb-1.5">TYPE OF COMMUNICATION</p>
              <p className="text-[13px] leading-relaxed text-ink">{message.angle.type}</p>
            </div>
            <div>
              <p className="section-number mb-1.5">REASON FOR OUTREACH</p>
              <p className="text-[13px] leading-relaxed text-ink-2">{message.angle.reason}</p>
            </div>
            <div>
              <p className="section-number mb-1.5">BENEFIT OF COLLABORATION</p>
              <p className="text-[13px] leading-relaxed text-ink-2">{message.angle.benefit}</p>
            </div>
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
