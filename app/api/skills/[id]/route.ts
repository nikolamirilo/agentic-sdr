import { findSkill, removeSkill, updateSkill } from "@/lib/skills/registry";
import { DUPLICATE_MESSAGE, SkillPatchSchema, isDuplicateSlug } from "@/lib/skills/validation";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

export async function GET(_request: Request, ctx: RouteContext<"/api/skills/[id]">) {
  const { id } = await ctx.params;
  try {
    const skill = await findSkill(id);
    if (!skill) return apiError("Skill not found", 404);
    return apiOk({ skill });
  } catch (error) {
    return handleError(error, "GET skill");
  }
}

/**
 * Edits apply to the skill itself, not to runs that already used it: a run
 * resolved its skills at entry, so past results stay explainable.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/skills/[id]">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, SkillPatchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const skill = await updateSkill(id, parsed.data);
    if (!skill) return apiError("Skill not found", 404);
    return apiOk({ skill });
  } catch (error) {
    if (isDuplicateSlug(error)) return apiError(DUPLICATE_MESSAGE, 409);
    return handleError(error, "PATCH skill");
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/skills/[id]">) {
  const { id } = await ctx.params;
  try {
    if (!(await removeSkill(id))) return apiError("Skill not found", 404);
    return apiOk({ deleted: id });
  } catch (error) {
    return handleError(error, "DELETE skill");
  }
}
