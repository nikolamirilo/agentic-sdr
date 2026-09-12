import { z } from "zod";
import { ALL_TOOLS } from "@/lib/skills/tools";

/** The shape both /api/skills and /api/skills/[id] accept. */
export const SkillBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["research", "outreach"]),
  instructions: z.string().trim().min(1).max(8000),
  toolAllowlist: z.array(z.enum(ALL_TOOLS)).default([]),
  /** Omit to create a global skill, offered for every product. */
  productId: z.string().uuid().nullish(),
});

/** Every field optional, but at least one present, so PATCH stays a patch. */
export const SkillPatchSchema = SkillBodySchema.omit({ productId: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

/** Postgres unique violation: the slug is already taken in this scope. */
export function isDuplicateSlug(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

export const DUPLICATE_MESSAGE =
  "A skill with that name already exists here. Pick a different name.";
