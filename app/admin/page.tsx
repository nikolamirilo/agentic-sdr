import Link from "next/link";
import { listProductsWithStatus } from "@/lib/db/queries";
import { features } from "@/lib/env";
import { hasModelProvider } from "@/lib/llm";
import { AdminShell, AppHeader } from "@/components/AppHeader";
import { Button, Card, Empty, IconArrowRight, IconPlus, Notice, Pill } from "@/components/ui";
import { hostOf } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * The way in. One job: choose a product to work on, or start a new one.
 * Everything about running the flow lives one level down, per product.
 */
export default async function AdminIndex() {
  const products = await listProductsWithStatus().catch(() => []);

  const missing = [
    !hasModelProvider() && "a model provider (XAI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)",
    !features.exa && "EXA_API_KEY",
    !features.firecrawl && "FIRECRAWL_API_KEY",
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <AdminShell>
          <AppHeader />
        </AdminShell>
      </div>

      <AdminShell>
        <main className="py-12 lg:py-16">
          {missing.length > 0 && (
            <div className="mb-8">
              <Notice tone="warn" title="Setup incomplete">
                Missing {missing.join(", ")}. Profile generation and research runs need these before
                they can run.
              </Notice>
            </div>
          )}

          <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-3">
                <span className="section-number">01</span>
                <span className="h-px w-10 bg-line-strong" aria-hidden />
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                  Products
                </span>
              </div>
              <h1 className="display text-ink">Pick up where you left off</h1>
              <p className="subhead mt-4">
                Each product keeps its own profile, runs, leads and outreach. Choose one to continue,
                or set up something new.
              </p>
            </div>

            <Link href="/admin/products/new">
              <Button variant="primary" size="lg">
                <IconPlus />
                New product
              </Button>
            </Link>
          </header>

          {products.length === 0 ? (
            <Empty title="No products yet">
              Register one to build its profile. We read the site and anything else you give us, then
              write the profile every later step scores against.
            </Empty>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <li key={product.id}>
                  <Link href={`/admin/products/${product.id}`} className="group block h-full">
                    <Card
                      padding="lg"
                      className="flex h-full flex-col transition-colors duration-150 group-hover:border-accent-line group-hover:bg-accent-tint/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-[17px] font-semibold leading-tight text-ink">
                            {product.name}
                          </h2>
                          {product.websiteUrl && (
                            <p className="mt-1 truncate text-[13px] text-ink-3">
                              {hostOf(product.websiteUrl)}
                            </p>
                          )}
                        </div>
                        <IconArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-3 transition-colors group-hover:text-accent" />
                      </div>

                      <div className="mt-6 flex flex-wrap items-center gap-1.5">
                        {product.profileVersion ? (
                          <Pill tone="good">Profile v{product.profileVersion}</Pill>
                        ) : (
                          <Pill tone="warn">No profile yet</Pill>
                        )}
                        {product.leadCount > 0 && (
                          <Pill>
                            <span className="tabular">{product.leadCount}</span>
                            <span className="opacity-70">
                              lead{product.leadCount === 1 ? "" : "s"}
                            </span>
                          </Pill>
                        )}
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>
      </AdminShell>
    </div>
  );
}
