"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SkillKind } from "@/lib/types";
import { Button, Card, Empty, Icon, Notice, Pill, Spinner, inputClass } from "@/components/ui";

/**
 * The library view. Filter and search exist because the list only grows: a
 * skill per market segment per product adds up faster than a flat list stays
 * readable.
 */

export type SkillRow = {
  id: string;
  name: string;
  kinds: SkillKind[];
  instructions: string;
  toolAllowlist: string[];
  productName: string | null;
};

type Filter = "all" | SkillKind;

/** Pills always read research first, whatever order the row came back in. */
const KIND_ORDER: SkillKind[] = ["research", "outreach"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "research", label: "Research" },
  { id: "outreach", label: "Outreach" },
];

export function SkillsList({ skills }: { skills: SkillRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Deleting asks first, on the card itself: one stray click should not take a
  // skill with it, but the confirm stays where the mistake would be made.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function remove(id: string) {
    setDeleting(id);
    setError("");
    try {
      const response = await fetch(`/api/skills/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete that skill");
      }
      // Hidden straight away, then reconciled by the refetch: the server list
      // is the truth, this only spares the row a beat of sitting there deleted.
      setGone((prev) => [...prev, id]);
      setConfirming(null);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  const live = skills.filter((skill) => !gone.includes(skill.id));

  const needle = search.trim().toLowerCase();
  const visible = live.filter((skill) => {
    // A skill marked for both shows under either filter.
    if (filter !== "all" && !skill.kinds.includes(filter)) return false;
    if (!needle) return true;
    return (
      skill.name.toLowerCase().includes(needle) ||
      skill.instructions.toLowerCase().includes(needle)
    );
  });

  const countOf = (id: Filter) =>
    id === "all" ? live.length : live.filter((skill) => skill.kinds.includes(id)).length;

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

      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty title={live.length === 0 ? "No skills yet" : "Nothing matches that"}>
          {live.length === 0
            ? "A skill is an instruction block plus the tools it may use. Create one and it becomes selectable on any run."
            : "Try a different search, or switch the filter back to All."}
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {visible.map((skill) => (
            <li key={skill.id} className="group">
              <Card
                padding="md"
                className="transition-colors duration-150 group-hover:border-accent-line group-hover:bg-accent-tint/40"
              >
                <div className="flex items-start gap-4">
                  <Link href={`/admin/skills/${skill.id}`} className="block min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-semibold leading-tight text-ink">
                        {skill.name}
                      </h2>
                      {KIND_ORDER.filter((kind) => skill.kinds.includes(kind)).map((kind) => (
                        <Pill key={kind} tone={kind === "research" ? "info" : "accent"}>
                          {kind === "research" ? "Research" : "Outreach"}
                        </Pill>
                      ))}
                      <Pill>{skill.productName ?? "Every product"}</Pill>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">
                      {skill.instructions.split("\n")[0]}
                    </p>
                    <p className="mt-2 text-[12px] text-ink-3">
                      {!skill.kinds.includes("research")
                        ? "No tools"
                        : skill.toolAllowlist.length === 0
                          ? "All tools allowed"
                          : `${skill.toolAllowlist.length} tool${
                              skill.toolAllowlist.length === 1 ? "" : "s"
                            } allowed`}
                    </p>
                  </Link>

                  {confirming === skill.id ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="hidden text-[13px] text-ink-2 sm:block">Delete it?</span>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleting === skill.id}
                        onClick={() => void remove(skill.id)}
                      >
                        {deleting === skill.id ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <Icon.Trash className="h-4 w-4" />
                        )}
                        Yes
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === skill.id}
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <Link
                        href={`/admin/skills/${skill.id}`}
                        className="flex items-center gap-1.5 px-2 text-[13px] font-medium text-ink-3 transition-colors group-hover:text-accent"
                      >
                        Edit
                        <Icon.ArrowRight className="h-4 w-4" />
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete this skill"
                        aria-label={`Delete ${skill.name}`}
                        onClick={() => {
                          setError("");
                          setConfirming(skill.id);
                        }}
                      >
                        <Icon.Trash className="h-4 w-4 text-ink-3 transition-colors hover:text-bad" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
