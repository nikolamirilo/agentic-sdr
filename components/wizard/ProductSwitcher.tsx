"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import type { ProductSummary } from "@/components/wizard/Step1Profile";
import { hostOf } from "@/lib/url";

/**
 * Lives in the header on every step. Switching product is a context change, so
 * it navigates for real rather than swapping local state — the new product has
 * its own profile, runs and leads to load.
 */
export function ProductSwitcher({
  current,
  products,
}: {
  current: ProductSummary | null;
  products: ProductSummary[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const others = products.filter((product) => product.id !== current?.id);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 max-w-[16rem] items-center gap-2 rounded-[9px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken"
      >
        <span className="min-w-0 truncate">{current?.name ?? "Select a product"}</span>
        <Icon.Chevron
          className={`h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-[12px] border border-line bg-surface shadow-raised"
        >
          {current && (
            <div className="border-b border-line px-4 py-3">
              <p className="section-number">CURRENT</p>
              <p className="mt-1 truncate text-[14px] font-medium">{current.name}</p>
            </div>
          )}

          {others.length > 0 && (
            <div className="max-h-72 overflow-y-auto border-b border-line py-1">
              {others.map((product) => (
                <a
                  key={product.id}
                  href={`/admin/products/${product.id}`}
                  role="menuitem"
                  className="block px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                >
                  <span className="block truncate text-[14px] text-ink">{product.name}</span>
                  {product.websiteUrl && (
                    <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                      {hostOf(product.websiteUrl)}
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}

          <a
            href="/admin"
            role="menuitem"
            className="flex items-center gap-2 border-b border-line px-4 py-3 text-[14px] text-ink-2 transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Icon.ArrowLeft className="h-4 w-4" />
            All products
          </a>
          <a
            href="/admin/products/new"
            role="menuitem"
            className="flex items-center gap-2 px-4 py-3 text-[14px] font-medium text-accent transition-colors hover:bg-accent-tint"
          >
            <Icon.Plus className="h-4 w-4" />
            New product
          </a>
        </div>
      )}
    </div>
  );
}
