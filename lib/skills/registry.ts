import {
  createSkill as createSkillRow,
  deleteSkill as deleteSkillRow,
  getSkill,
  getSkillsByIds,
  insertDefaultSkill,
  listSkills,
  markSkillSeeded,
  seededSkillSlugs,
  updateSkill as updateSkillRow,
} from "@/lib/db/queries";
import { DEFAULT_SKILLS } from "@/lib/skills/defaults";
import { ALL_TOOLS } from "@/lib/skills/tools";
import type { Skill, SkillKind } from "@/lib/types";

/**
 * Skills are resolved once at graph entry. Their instructions are concatenated
 * into the system prompt of the nodes each of their kinds maps to, and the tool
 * layer filters available tools to the union of the allowlists.
 */

export { ALL_TOOLS };
export type { ToolName } from "@/lib/skills/tools";

export type ResolvedSkills = {
  skills: Skill[];
  /** Concatenated instructions, ready to append to a system prompt. */
  instructions: string;
  /** Union of the allowlists. Empty selection means every tool stays available. */
  allowedTools: Set<string>;
  names: string[];
};

export function resolveSkills(skills: Skill[], kind: SkillKind): ResolvedSkills {
  // A skill marked for both kinds contributes to both halves of the run.
  const relevant = skills.filter((skill) => skill.kinds.includes(kind));
  const allowed = new Set<string>();
  for (const skill of relevant) for (const tool of skill.toolAllowlist) allowed.add(tool);
  if (allowed.size === 0) for (const tool of ALL_TOOLS) allowed.add(tool);

  const instructions = relevant
    .map((skill) => `## Skill: ${skill.name}\n\n${skill.instructions.trim()}`)
    .join("\n\n");

  return {
    skills: relevant,
    instructions,
    allowedTools: allowed,
    names: relevant.map((skill) => skill.name),
  };
}

export async function loadSkills(ids: string[]): Promise<Skill[]> {
  return getSkillsByIds(ids);
}

export async function availableSkills(kind?: SkillKind, productId?: string): Promise<Skill[]> {
  return listSkills(kind, productId);
}

/**
 * Called on boot so the selector is never empty. Each default is planted at
 * most once, ever: after that the row belongs to the user, so an edit survives
 * a restart and a delete stays deleted. A default added to the code later still
 * arrives, because it has not been planted yet.
 */
export async function seedDefaultSkills(): Promise<number> {
  const planted = await seededSkillSlugs();
  let count = 0;
  for (const seed of DEFAULT_SKILLS) {
    if (planted.has(seed.slug)) continue;
    await insertDefaultSkill(seed);
    await markSkillSeeded(seed.slug);
    count += 1;
  }
  return count;
}

/* ------------------------------------------------------------ management */

export type SkillInput = {
  name: string;
  kinds: SkillKind[];
  instructions: string;
  toolAllowlist: string[];
  /** null keeps the skill global, i.e. offered for every product. */
  productId: string | null;
};

/**
 * A url-safe handle derived from the name. It is what the seeder keys on, so a
 * user-created skill that happens to collide with a default slug is rejected by
 * the unique index rather than silently merged.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "skill";
}

export async function createSkill(input: SkillInput): Promise<Skill> {
  return createSkillRow({
    productId: input.productId,
    slug: slugify(input.name),
    name: input.name,
    kinds: input.kinds,
    instructions: input.instructions,
    toolAllowlist: normaliseTools(input.toolAllowlist),
  });
}

export async function updateSkill(
  id: string,
  patch: Partial<Omit<SkillInput, "productId">>
): Promise<Skill | undefined> {
  return updateSkillRow(id, {
    // Renaming re-derives the slug so the handle never contradicts the name.
    slug: patch.name === undefined ? undefined : slugify(patch.name),
    name: patch.name,
    kinds: patch.kinds,
    instructions: patch.instructions,
    toolAllowlist: patch.toolAllowlist ? normaliseTools(patch.toolAllowlist) : undefined,
  });
}

export async function removeSkill(id: string): Promise<boolean> {
  return deleteSkillRow(id);
}

export async function findSkill(id: string): Promise<Skill | undefined> {
  return getSkill(id);
}

/** Drops anything the graphs would not recognise, and de-duplicates. */
function normaliseTools(tools: string[]): string[] {
  const known = new Set<string>(ALL_TOOLS);
  return [...new Set(tools)].filter((tool) => known.has(tool));
}

export function toolAllowed(allowed: Set<string>, tool: string): boolean {
  return allowed.has(tool);
}
