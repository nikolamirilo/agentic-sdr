import Link from "next/link";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { NewProductForm } from "@/components/NewProductForm";
import { IconArrowLeft } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function NewProductPage() {
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
            href="/admin"
            className="mb-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
            All products
          </Link>

          <header className="mb-10 max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="section-number">01</span>
              <span className="h-px w-10 bg-line-strong" aria-hidden />
              <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                New product
              </span>
            </div>
            <h1 className="display text-ink">Tell us what you sell</h1>
            <p className="subhead mt-4">
              Point us at your site and add any material you have. This is the raw input the profile
              gets written from.
            </p>
          </header>

          <NewProductForm />
        </main>
      </AdminShell>
    </div>
  );
}
