import { cookies } from "next/headers";
import {
  emailFromIdToken,
  exchangeCode,
  gmailConfigured,
  saveAccount,
  GMAIL_SCOPE,
} from "@/lib/providers/gmail";
import { env } from "@/lib/env";
import { apiError } from "@/lib/api";
import { safeInternalPath } from "@/lib/url";

/**
 * Exchanges the code, encrypts the refresh token and stores it. Nothing about
 * the token is logged, including on the error paths.
 *
 * Every outcome lands back on the screen the flow started from with a `gmail`
 * query param, so the same connection state is reported in one place whether
 * it was started from settings or from the Outreach step.
 */
export async function GET(request: Request) {
  if (!gmailConfigured()) return apiError("Gmail is not configured", 503);

  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (!state) return apiError("Missing state", 400);

  let productId: string;
  let nonce: string;
  let from: string | null;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    productId = decoded.productId;
    nonce = decoded.nonce;
    from = safeInternalPath(decoded.from ?? undefined);
  } catch {
    return apiError("Malformed state", 400);
  }

  // Where to land, in order of preference: the screen that started the flow,
  // then the Outreach step of that product's flow.
  const back = (status: string) => {
    const path = from ?? `/admin/products/${productId}?step=5`;
    return redirectWith(`${path}${path.includes("?") ? "&" : "?"}gmail=${status}`);
  };

  const expected = (await cookies()).get("gmail_oauth_nonce")?.value;
  if (!expected || expected !== nonce) {
    return apiError("This authorization did not start here", 403);
  }

  // Checked after the nonce: a denial still has to prove it belongs to this flow.
  if (denied) return back("denied");
  if (!code) return apiError("Missing code", 400);

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      // Google only returns one on first consent, so a re-auth without prompt
      // leaves us unable to send later. Better to say so now.
      return back("no_refresh_token");
    }
    if (!tokens.scope?.includes(GMAIL_SCOPE)) {
      return back("missing_scope");
    }

    const email = emailFromIdToken(tokens.id_token) ?? "unknown@unknown";
    await saveAccount({
      productId,
      email,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope,
    });

    return back("connected");
  } catch {
    return back("failed");
  }
}

function redirectWith(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: `${env.appUrl}${path}`,
      "set-cookie": "gmail_oauth_nonce=; Path=/; HttpOnly; Max-Age=0",
    },
  });
}
