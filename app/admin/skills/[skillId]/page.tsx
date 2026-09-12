import Link from "next/link";
import { notFound } from "next/navigation";
import { getSkill, listProducts } from "@/lib/db/queries";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { SkillForm } from "@/components/SkillForm";
import { IconArrowLeft, Pill } from "@/components/ui";
import { safeInternalPath } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function EditSkillPage(props: PageProps<"/admin/skills/[skillId]">) {
  const { skillId } = await props.params;
  const params = await props.searchParams;
  const from = safeInternalPath(single(params.from));
  const backTo = from ? `/admin/skills?from=${encodeURIComponent(from)}` : "/admin/skills";

  const skill = await getSkill(skillId).catch(() => undefined);
  if (!skill) notFound();

  const products = await listProducts().catch(() => []);

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <AdminShell>
          <AppHeader />
        </AdminShell>
      </div>

      <AdminShell>
        <main className="py-12 lg:py-16">
          <Link
            href={backTo}
            className="mb-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
            All skills
          </Link>

          <header className="mb-10 max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="section-number">02</span>
              <span className="h-px w-10 bg-line-strong" aria-hidden />
              <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                Edit skill
              </span>
            </div>
            <h1 className="display text-ink">{skill.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Pill tone={skill.kind === "research" ? "info" : "accent"}>
                {skill.kind === "research" ? "Research" : "Outreach"}
              </Pill>
              <Pill>{skill.slug}</Pill>
            </div>
            <p className="subhead mt-4">
              Changes apply to the next run that selects it. Runs that already used it keep the
              wording they ran with.
            </p>
          </header>

          <SkillForm skill={skill} products={products} backTo={backTo} />
        </main>
      </AdminShell>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
