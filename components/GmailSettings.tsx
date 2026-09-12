"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Icon, Notice, Pill, Spinner } from "@/components/ui";

/**
 * Gmail connection management.
 *
 * One row per product, because sending is per product: the address a run sends
 * from is looked up by product id, so "connect Gmail" has to name which
 * product it is connecting for. A product with no connection can still draft
 * and approve — only the send step is blocked.
 */

export type GmailConnectionRow = {
  productId: string;
  productName: string;
  websiteUrl: string | null;
  /** Null until this product has a connection. */
  accountId: string | null;
  email: string | null;
  connectedAt: string | null;
};

/** The `?gmail=` value the OAuth callback comes back with. */
export type GmailCallbackStatus =
  | "connected"
  | "denied"
  | "failed"
  | "missing_scope"
  | "no_refresh_token";

const STATUS: Record<
  GmailCallbackStatus,
  { tone: "good" | "warn" | "bad"; title: string; detail: string }
> = {
  connected: {
    tone: "good",
    title: "Gmail connected",
    detail: "Approved drafts for this product will send from the connected address.",
  },
  denied: {
    tone: "warn",
    title: "Connection cancelled",
    detail: "Google sign-in was dismissed before the permission was granted. Nothing was stored.",
  },
  failed: {
    tone: "bad",
    title: "Connection failed",
    detail:
      "Google rejected the exchange. Check that GOOGLE_REDIRECT_URI matches the one registered on the OAuth client, then try again.",
  },
  missing_scope: {
    tone: "warn",
    title: "Send permission not granted",
    detail:
      "The consent screen completed without the gmail.send scope, so nothing could send. Connect again and leave the send permission checked.",
  },
  no_refresh_token: {
    tone: "warn",
    title: "No refresh token issued",
    detail:
      "Google only issues one on first consent. Remove this app under your Google account's third-party access, then connect again.",
  },
};

export function GmailSettings({
  configured,
  rows,
  status,
}: {
  configured: boolean;
  rows: GmailConnectionRow[];
  status: GmailCallbackStatus | null;
}) {
  const router = useRouter();
  /** Keyed by product, not by account: an unconnected row has no account id. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function disconnect(row: GmailConnectionRow) {
    if (!row.accountId) return;
    const ok = window.confirm(
      `Disconnect ${row.email} from ${row.productName}? Access is revoked at Google, and reconnecting goes through consent again.`
    );
    if (!ok) return;

    setBusy(row.productId);
    setError("");
    try {
      const response = await fetch("/api/gmail/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: row.accountId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Disconnect failed (${response.status})`);
      }
      // The rows are server-rendered, so the list has to come from the server.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const note = status ? STATUS[status] : null;

  return (
    <>
      {note && (
        <div className="mb-6">
          <Notice tone={note.tone} title={note.title}>
            {note.detail}
          </Notice>
        </div>
      )}

      {error && (
        <div className="mb-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="No products yet">
          A Gmail connection is attached to a product, because that is what decides which address a
          run sends from. Register a product first, then come back here.
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li key={row.productId}>
              <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold leading-tight text-ink">
                      {row.productName}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {row.email ? (
                        <>
                          <Pill tone="good" icon={<Icon.Check className="h-3.5 w-3.5" />}>
                            {row.email}
                          </Pill>
                          {row.connectedAt && (
                            <span className="text-[13px] text-ink-3">
                              connected {formatDate(row.connectedAt)}
                            </span>
                          )}
                        </>
                      ) : (
                        <Pill tone="warn" icon={<Icon.Warning className="h-3.5 w-3.5" />}>
                          Not connected
                        </Pill>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {busy === row.productId ? (
                      <Spinner className="h-4 w-4 text-ink-3" />
                    ) : (
                      <>
                        <a
                          href={
                            configured
                              ? `/api/gmail/connect?productId=${row.productId}&from=${encodeURIComponent(
                                  "/admin/settings"
                                )}`
                              : undefined
                          }
                          aria-disabled={!configured}
                          className={`inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 text-sm font-medium transition-colors ${
                            configured
                              ? "hover:bg-surface-sunken"
                              : "pointer-events-none opacity-40"
                          }`}
                        >
                          <Icon.Mail className="h-4 w-4" />
                          {row.email ? "Reconnect" : "Connect Gmail"}
                        </a>
                        {row.accountId && (
                          <Button variant="danger" onClick={() => void disconnect(row)}>
                            <Icon.Trash className="h-4 w-4" />
                            Disconnect
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * Deliberately not `toLocaleDateString`: this renders on the server first, and
 * a locale the browser disagrees with turns the date into a hydration mismatch.
 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
