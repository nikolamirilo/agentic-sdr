import { z } from "zod";
import { startResearchRun } from "@/lib/runs/manager";
import { getProduct, listRuns } from "@/lib/db/queries";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

const StartRunSchema = z.object({
  productId: z.string().uuid(),
  targetCount: z.number().int().min(1).max(50).default(5),
  useProfile: z.boolean().default(true),
  skillIds: z.array(z.string().uuid()).max(5).default([]),
  budgetCandidates: z.number().int().min(10).max(1000).optional(),
  budgetSeconds: z.number().int().min(30).max(3600).optional(),
});

export async function GET(request: Request) {
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return apiError("productId is required", 400);
  try {
    return apiOk({ runs: await listRuns(productId) });
  } catch (error) {
    return handleError(error, "GET /api/runs");
  }
}

/**
 * Inserts the run row, kicks the graph off detached, and returns in well under
 * 100ms. The browser then attaches to the SSE stream.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, StartRunSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const product = await getProduct(parsed.data.productId);
    if (!product) return apiError("Product not found", 404);

    const run = await startResearchRun(parsed.data);
    return apiOk({ runId: run.id, run }, 202);
  } catch (error) {
    const message = (error as Error).message;
    // These are operator-fixable setup problems, not server faults.
    if (message.includes("No model provider") || message.includes("no profile yet")) {
      return apiError(message, 409);
    }
    return handleError(error, "POST /api/runs");
  }
}
