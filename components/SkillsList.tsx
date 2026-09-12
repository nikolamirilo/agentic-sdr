"use client";

import { useState } from "react";
import Link from "next/link";
import type { SkillKind } from "@/lib/types";
import { Card, Empty, Icon, Pill, inputClass } from "@/components/ui";

/**
 * The library view. Filter and search exist because the list only grows: a
 * skill per market segment per product adds up faster than a flat list stays
 * readable.
 */

export type SkillRow = {
  id: string;
  name: string;
  kind: SkillKind;
  instructions: string;
  toolAllowlist: string[];
  productName: string | null;
};

type Filter = "all" | SkillKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "research", label: "Research" },
  { id: "outreach", label: "Outreach" },
];

export function SkillsList({ skills }: { skills: SkillRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();
  const visible = skills.filter((skill) => {
    if (filter !== "all" && skill.kind !== filter) return false;
    if (!needle) return true;
    return (
      skill.name.toLowerCase().includes(needle) ||
      skill.instructions.toLowerCase().includes(needle)
    );
  });

  const countOf = (id: Filter) =>
    id === "all" ? skills.length : skills.filter((skill) => skill.kind === id).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-[10px] border border-line bg-surface-sunken p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
                filter === option.id
                  ? "bg-surface text-ink shadow-card"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {option.label}
              <span className="tabular ml-1.5 text-ink-3">{countOf(option.id)}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[14rem] flex-1">
          <Icon.Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            className={`${inputClass} pl-10`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names and instructions"
            aria-label="Search skills"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty title={skills.length === 0 ? "No skills yet" : "Nothing matches that"}>
          {skills.length === 0
            ? "A skill is an instruction block plus the tools it may use. Create one and it becomes selectable on any run."
            : "Try a different search, or switch the filter back to All."}
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {visible.map((skill) => (
            <li key={skill.id}>
              <Link href={`/admin/skills/${skill.id}`} className="group block">
                <Card
                  padding="md"
                  className="transition-colors duration-150 group-hover:border-accent-line group-hover:bg-accent-tint/40"
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[16px] font-semibold leading-tight text-ink">
                          {skill.name}
                        </h2>
                        <Pill tone={skill.kind === "research" ? "info" : "accent"}>
                          {skill.kind === "research" ? "Research" : "Outreach"}
                        </Pill>
                        <Pill>{skill.productName ?? "Every product"}</Pill>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">
                        {skill.instructions.split("\n")[0]}
                      </p>
                      <p className="mt-2 text-[12px] text-ink-3">
                        {skill.kind === "outreach"
                          ? "No tools"
                          : skill.toolAllowlist.length === 0
                            ? "All tools allowed"
                            : `${skill.toolAllowlist.length} tool${
                                skill.toolAllowlist.length === 1 ? "" : "s"
                              } allowed`}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors group-hover:text-accent">
                      Edit
                      <Icon.ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
