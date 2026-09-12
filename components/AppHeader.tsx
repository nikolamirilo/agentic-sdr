"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

/**
 * Shared top bar. The wizard stacks its step rail directly underneath this, so
 * the wordmark sits in exactly the same place on every screen in /admin.
 *
 * Skills and settings sit here rather than inside one step because they are
 * what the whole flow draws on: the moment you want to change one is usually
 * the moment you are looking at results you did not like, two steps away from
 * the picker. `skillsFrom` is the path to come back to — it names the return
 * path for both links — so leaving the flow is not one-way.
 */
export function AppHeader({ right, skillsFrom }: { right?: ReactNode; skillsFrom?: string }) {
  return (
    <div className="flex h-16 items-center justify-between gap-4">
      <Link href="/admin" className="flex items-center gap-2.5">
        <Image
          src="/logo.png"
          alt=""
          width={24}
          height={24}
          priority
          className="h-6 w-6 rounded-[7px] object-contain"
        />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">SignalFit</span>
      </Link>
      <div className="flex items-center gap-3">
        {right}
        <Link
          href={skillsFrom ? `/admin/skills?from=${encodeURIComponent(skillsFrom)}` : "/admin/skills"}
          className={navLinkClass}
        >
          <Icon.Sliders className="h-4 w-4" />
          Skills
        </Link>
        <Link
          href={
            skillsFrom ? `/admin/settings?from=${encodeURIComponent(skillsFrom)}` : "/admin/settings"
          }
          className={navLinkClass}
        >
          <Icon.Gear className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}

const navLinkClass =
  "flex h-9 items-center gap-2 rounded-[9px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken";

/** Consistent page width for everything under /admin. */
export function AdminShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[76rem] px-6 lg:px-10">{children}</div>;
}
