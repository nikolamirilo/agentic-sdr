import Link from "next/link";
import { listProducts } from "@/lib/db/queries";
import { gmailConfigured, listAccounts } from "@/lib/providers/gmail";
import { env } from "@/lib/env";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import {
  GmailSettings,
  type GmailCallbackStatus,
  type GmailConnectionRow,
} from "@/components/GmailSettings";
import { Card, IconArrowLeft, Notice } from "@/components/ui";
import { safeInternalPath } from "@/lib/url";

export const dynamic = "force-dynamic";

const CALLBACK_STATUSES = [
  "connected",
  "denied",
  "failed",
  "missing_scope",
  "no_refresh_token",
] as const;

/**
 * Settings. Today that means the Gmail connection, which used to be reachable
 * only from step four of a flow — the one place you are least likely to be
 * standing when you decide to change which account sends.
 */
export default async function SettingsPage(props: PageProps<"/admin/settings">) {
  const params = await props.searchParams;
  const from = safeInternalPath(single(params.from));
  const status = asStatus(single(params.gmail));

  const configured = gmailConfigured();

  const [products, accounts] = await Promise.all([
    listProducts().catch(() => []),
    configured ? listAccounts().catch(() => []) : Promise.resolve([]),
  ]);

  // Newest first from the query, so the first hit per product is the live one.
  const byProduct = new Map(accounts.map((account) => [account.productId, account]));

  const rows: GmailConnectionRow[] = products.map((product) => {
    const account = byProduct.get(product.id);
    return {
      productId: product.id,
      productName: product.name,
      websiteUrl: product.websiteUrl,
      accountId: account?.id ?? null,
      email: account?.email ?? null,
      connectedAt: account?.connectedAt ?? null,
    };
  });

  const missing = [
    !env.googleClientId && "GOOGLE_CLIENT_ID",
    !env.googleClientSecret && "GOOGLE_CLIENT_SECRET",
    !env.googleRedirectUri && "GOOGLE_REDIRECT_URI",
    !env.tokenEncryptionKey && "TOKEN_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <AdminShell>
          <AppHeader />
        </AdminShell>
      </div>

      <AdminShell>
        <main className="py-12 lg:py-16">
          <Link
            href={from ?? "/admin"}
            className="mb-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
            {from ? "Back to the flow" : "All products"}
          </Link>

          <header className="mb-10 max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="section-number">01</span>
              <span className="h-px w-10 bg-line-strong" aria-hidden />
              <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                Settings
              </span>
            </div>
            <h1 className="display text-ink">Connections</h1>
            <p className="subhead mt-4">
              Outreach sends through your own Gmail account over OAuth. The scope granted is
              send-only — this app cannot read your mail — and nothing is ever sent without you
              approving the draft first.
            </p>
          </header>

          {!configured && (
            <div className="mb-6">
              <Notice tone="warn" title="Gmail is not configured on this deployment">
                Missing {missing.join(", ")}. Set {missing.length === 1 ? "it" : "them"} and restart
                before connecting an account. Drafting and approval work without this; only sending
                is blocked.
              </Notice>
            </div>
          )}

          <GmailSettings configured={configured} rows={rows} status={status} />

          <Card padding="lg" className="mt-8">
            <h2 className="text-[15px] font-semibold text-ink">How the connection works</h2>
            <dl className="mt-4 grid gap-4 text-[14px] leading-relaxed sm:grid-cols-2">
              <div>
                <dt className="font-medium text-ink">Scope</dt>
                <dd className="mt-1 text-ink-2">
                  <code className="font-mono text-[13px]">gmail.send</code> only. No read, no
                  delete, no access to existing threads.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Token storage</dt>
                <dd className="mt-1 text-ink-2">
                  The refresh token is encrypted with AES-256-GCM before it reaches the database.
                  Access tokens are fetched per send and never stored.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">One account per product</dt>
                <dd className="mt-1 text-ink-2">
                  Each product sends from its own address, so a run always knows which inbox it is
                  writing from.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Redirect URI</dt>
                <dd className="mt-1 break-all text-ink-2">
                  <code className="font-mono text-[13px]">
                    {env.googleRedirectUri ?? `${env.appUrl}/api/gmail/callback`}
                  </code>
                  <span className="mt-1 block text-ink-3">
                    Must match the one registered on the Google OAuth client exactly.
                  </span>
                </dd>
              </div>
            </dl>
          </Card>
        </main>
      </AdminShell>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Anything the callback did not send is ignored rather than rendered. */
function asStatus(value: string | undefined): GmailCallbackStatus | null {
  return CALLBACK_STATUSES.includes(value as GmailCallbackStatus)
    ? (value as GmailCallbackStatus)
    : null;
}
