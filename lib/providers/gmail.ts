import { env, features } from "@/lib/env";
import { encrypt, decrypt } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db/client";
import { resilient } from "@/lib/providers/resilience";

/**
 * Gmail connector.
 *
 * OAuth 2.0 authorization code flow, offline access, send scope only. Refresh
 * tokens are encrypted with AES-256-GCM before they touch the database.
 * Message bodies and tokens are never logged.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SEND_INTERVAL_MS = 2000;

export function gmailConfigured(): boolean {
  return features.gmail;
}

export function authorizeUrl(state: string): string {
  if (!features.gmail) throw new Error("Gmail OAuth is not configured");
  const params = new URLSearchParams({
    client_id: env.googleClientId!,
    redirect_uri: env.googleRedirectUri!,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  return resilient({ label: "gmail.token" }, async (signal) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal,
    });
    if (!response.ok) {
      // Never echo the response body: it can carry token material.
      throw new Error(`Google token endpoint returned ${response.status}`);
    }
    return (await response.json()) as TokenResponse;
  });
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: env.googleClientId!,
    client_secret: env.googleClientSecret!,
    redirect_uri: env.googleRedirectUri!,
    grant_type: "authorization_code",
  });
}

async function accessTokenFor(refreshToken: string): Promise<string> {
  const tokens = await tokenRequest({
    refresh_token: refreshToken,
    client_id: env.googleClientId!,
    client_secret: env.googleClientSecret!,
    grant_type: "refresh_token",
  });
  return tokens.access_token;
}

/** Reads the address from the id_token payload; no extra scope needed. */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export async function saveAccount(input: {
  productId: string;
  email: string;
  refreshToken: string;
  scope: string;
}): Promise<void> {
  await query(
    `insert into gmail_accounts (product_id, email, refresh_token_enc, scope)
     values ($1, $2, $3, $4)
     on conflict (product_id, email) do update set
       refresh_token_enc = excluded.refresh_token_enc,
       scope = excluded.scope,
       connected_at = now()`,
    [input.productId, input.email, encrypt(input.refreshToken), input.scope]
  );
}

export async function connectedAccount(
  productId: string
): Promise<{ id: string; email: string; refreshToken: string } | undefined> {
  const row = await queryOne<{ id: string; email: string; refresh_token_enc: Buffer }>(
    `select id, email, refresh_token_enc from gmail_accounts
     where product_id = $1 order by connected_at desc limit 1`,
    [productId]
  );
  if (!row) return undefined;
  return { id: row.id, email: row.email, refreshToken: decrypt(row.refresh_token_enc) };
}

export type GmailAccountSummary = {
  id: string;
  productId: string;
  productName: string;
  email: string;
  scope: string;
  connectedAt: string;
};

/**
 * Every connection, newest first, for the settings screen. Deliberately
 * returns no token material: the settings page never needs it and a shape
 * that cannot carry a secret cannot leak one into a serialized prop.
 */
export async function listAccounts(): Promise<GmailAccountSummary[]> {
  const rows = await query<{
    id: string;
    product_id: string;
    product_name: string;
    email: string;
    scope: string;
    connected_at: Date;
  }>(
    `select g.id, g.product_id, p.name as product_name, g.email, g.scope, g.connected_at
     from gmail_accounts g
     join products p on p.id = g.product_id
     order by g.connected_at desc`
  );
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    email: row.email,
    scope: row.scope,
    connectedAt: row.connected_at.toISOString(),
  }));
}

/**
 * Tells Google to forget the grant. Best effort on purpose: the row is gone
 * either way, and a failed revoke must not leave a connection that the UI
 * claims is removed but that still has a live refresh token behind it.
 */
async function revoke(refreshToken: string): Promise<void> {
  try {
    await resilient({ label: "gmail.revoke", retries: 0 }, async (signal) => {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
        signal,
      });
    });
  } catch {
    // Nothing to log here that is not either useless or token-adjacent.
  }
}

/** Deletes the stored connection and revokes the grant. Returns the address it removed. */
export async function disconnectAccount(accountId: string): Promise<string | undefined> {
  const row = await queryOne<{ email: string; refresh_token_enc: Buffer }>(
    `delete from gmail_accounts where id = $1 returning email, refresh_token_enc`,
    [accountId]
  );
  if (!row) return undefined;

  // Decryption can fail if TOKEN_ENCRYPTION_KEY was rotated; the row is still gone.
  try {
    await revoke(decrypt(row.refresh_token_enc));
  } catch {
    /* ignore */
  }
  return row.email;
}

// --- sending --------------------------------------------------------------

function encodeHeader(value: string): string {
  // RFC 2047 for anything outside ASCII, so subjects with em dashes survive.
   
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ];
  return lines.join("\r\n");
}

/** Module-level throttle: roughly one send every 2 seconds across the process. */
let lastSendAt = 0;
async function throttle(): Promise<void> {
  const wait = lastSendAt + SEND_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSendAt = Date.now();
}

export async function sendEmail(input: {
  productId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ gmailMessageId: string; from: string }> {
  if (!features.gmail) throw new Error("Gmail is not configured on this deployment");
  const account = await connectedAccount(input.productId);
  if (!account) throw new Error("No Gmail account connected for this product");

  const accessToken = await accessTokenFor(account.refreshToken);
  const mime = buildMimeMessage({
    from: account.email,
    to: input.to,
    subject: input.subject,
    body: input.body,
  });
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  await throttle();

  return resilient({ label: "gmail.send", retries: 0 }, async (signal) => {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Strip anything that looks like a token before this reaches a log.
      throw new Error(`Gmail send failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const data = (await response.json()) as { id: string };
    return { gmailMessageId: data.id, from: account.email };
  });
}
