import type { ProductProfile } from "@/lib/types";

/** Rendering the profile the same way everywhere keeps node prompts comparable. */

export function renderProfile(profile: ProductProfile): string {
  const terms = profile.domainLanguage.terms
    .slice(0, 25)
    .map((t) => `- ${t.term}: ${t.meaning}`)
    .join("\n");

  return `# Product
${profile.productDefinition.name} — ${profile.productDefinition.oneLiner}
${profile.productDefinition.whatItDoes}

Problems solved:
${profile.productDefinition.problemsSolved.map((p) => `- ${p}`).join("\n")}

Differentiators:
${profile.productDefinition.differentiators.map((d) => `- ${d}`).join("\n")}

# Ideal customer profile
${profile.icp.summary}
- Company types: ${profile.icp.companyTypes.join(", ")}
- Industries: ${profile.icp.industries.join(", ")}
- Company size: ${profile.icp.companySize}
- Geographies: ${profile.icp.geographies.join(", ")}
- Buyer roles: ${profile.icp.buyerRoles.join(", ")}
- Trigger signals: ${profile.icp.triggerSignals.join(", ")}

# Domain language (use these words, not generic marketing language)
${terms || "- (none captured)"}

# Domain knowledge
${profile.domainKnowledge.marketSummary}
Pain points: ${profile.domainKnowledge.painPoints.join("; ")}
Competitors: ${profile.domainKnowledge.competitors.join(", ")}

# Disqualifiers
${profile.disqualifiers.map((d) => `- [${d.id}] ${d.rule} (${d.rationale})`).join("\n") || "- (none)"}`;
}

export function renderCriteria(profile: ProductProfile): string {
  return profile.scoringCriteria
    .map((c) => `- [${c.id}] (weight ${c.weight}) ${c.question}`)
    .join("\n");
}

export function withSkills(base: string, skillInstructions: string): string {
  if (!skillInstructions.trim()) return base;
  return `${base}\n\n# Active skills\nThe operator selected these skills for this run. Follow them where they conflict with your defaults.\n\n${skillInstructions}`;
}
