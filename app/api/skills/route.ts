import { availableSkills, createSkill } from "@/lib/skills/registry";
import { getProduct } from "@/lib/db/queries";
import { DUPLICATE_MESSAGE, SkillBodySchema, isDuplicateSlug } from "@/lib/skills/validation";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";
import type { SkillKind } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as SkillKind | null;
  const productId = url.searchParams.get("productId") ?? undefined;
  try {
    return apiOk({ skills: await availableSkills(kind ?? undefined, productId) });
  } catch (error) {
    return handleError(error, "GET /api/skills");
  }
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, SkillBodySchema);
  if (!parsed.ok) return parsed.response;

  const productId = parsed.data.productId ?? null;

  try {
    if (productId && !(await getProduct(productId))) {
      return apiError("Product not found", 404);
    }

    const skill = await createSkill({
      name: parsed.data.name,
      kind: parsed.data.kind,
      instructions: parsed.data.instructions,
      toolAllowlist: parsed.data.toolAllowlist,
      productId,
    });
    return apiOk({ skill }, 201);
  } catch (error) {
    if (isDuplicateSlug(error)) return apiError(DUPLICATE_MESSAGE, 409);
    return handleError(error, "POST /api/skills");
  }
}
