import { authorizeUrl, gmailConfigured } from "@/lib/providers/gmail";
import { apiError } from "@/lib/api";

/**
 * Starts the OAuth flow. `state` carries the product id and a nonce, so the
 * callback knows which product to attach the account to and can reject a
 * request it did not start.
 */
export async function GET(request: Request) {
  if (!gmailConfigured()) {
    return apiError(
      "Gmail is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.",
      503
    );
  }

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return apiError("productId is required", 400);

  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ productId, nonce })).toString("base64url");

  const response = Response.redirect(authorizeUrl(state), 302);
  const headers = new Headers(response.headers);
  headers.append(
    "set-cookie",
    `gmail_oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
  return new Response(null, { status: 302, headers });
}
