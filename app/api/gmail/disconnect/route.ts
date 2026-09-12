import { z } from "zod";
import { disconnectAccount, gmailConfigured } from "@/lib/providers/gmail";
import { UUID, apiError, apiOk, handleError, parseBody } from "@/lib/api";

const Body = z.object({ accountId: UUID });

/**
 * Removes a stored connection. The grant is revoked at Google too, so a
 * disconnect here is not just a local forget — reconnecting goes through
 * consent again and issues a fresh refresh token.
 */
export async function POST(request: Request) {
  if (!gmailConfigured()) return apiError("Gmail is not configured", 503);

  const parsed = await parseBody(request, Body);
  if (!parsed.ok) return parsed.response;

  try {
    const email = await disconnectAccount(parsed.data.accountId);
    if (!email) return apiError("That connection no longer exists", 404);
    return apiOk({ disconnected: email });
  } catch (error) {
    return handleError(error, "gmail disconnect");
  }
}
