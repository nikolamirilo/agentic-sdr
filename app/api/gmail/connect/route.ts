import { authorizeUrl, gmailConfigured } from "@/lib/providers/gmail";
import { apiError } from "@/lib/api";
import { safeInternalPath } from "@/lib/url";

/**
 * Starts the OAuth flow. `state` carries the product id, a nonce and where to
 * come back to, so the callback knows which product to attach the account to,
 * can reject a request it did not start, and returns to the screen the user
 * actually pressed the button on — step four of the flow, or settings.
 */
export async function GET(request: Request) {
  if (!gmailConfigured()) {
    return apiError(
      "Gmail is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.",
      503
    );
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return apiError("productId is required", 400);

  const from = safeInternalPath(url.searchParams.get("from") ?? undefined);

  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ productId, nonce, from })).toString("base64url");

  const headers = new Headers({ location: authorizeUrl(state) });
  headers.append(
    "set-cookie",
    `gmail_oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
  return new Response(null, { status: 302, headers });
}
