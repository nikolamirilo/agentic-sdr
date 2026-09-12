import Link from "next/link";
import { listAllSkills } from "@/lib/db/queries";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { SkillsList } from "@/components/SkillsList";
import { Button, IconArrowLeft, IconPlus } from "@/components/ui";
import { safeInternalPath } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * The skill library. It sits beside products rather than inside one, because a
 * skill is reusable across them and is just as likely to be edited while
 * looking at disappointing results as while setting a run up.
 */
export default async function SkillsIndex(props: PageProps<"/admin/skills">) {
  const params = await props.searchParams;
  const from = safeInternalPath(single(params.from));
  const skills = await listAllSkills().catch(() => []);

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
            href={from ?? "/admin"}
            className="mb-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
            {from ? "Back to the flow" : "All products"}
          </Link>

          <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-3">
                <span className="section-number">01</span>
                <span className="h-px w-10 bg-line-strong" aria-hidden />
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                  Skills
                </span>
              </div>
              <h1 className="display text-ink">How the loop behaves</h1>
              <p className="subhead mt-4">
                A skill is a named instruction block plus the tools it may use. Selecting different
                ones on a run changes how it searches, scores and writes — no code, no prompt
                editing.
              </p>
            </div>

            <Link href={withFrom("/admin/skills/new", from)}>
              <Button variant="primary" size="lg">
                <IconPlus />
                New skill
              </Button>
            </Link>
          </header>

          <SkillsList skills={skills} />
        </main>
      </AdminShell>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Carries the return path forward so the whole section leads back where you came from. */
function withFrom(path: string, from: string | null): string {
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}
