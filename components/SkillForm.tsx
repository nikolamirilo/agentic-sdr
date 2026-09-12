"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Skill, SkillKind } from "@/lib/types";
import { ALL_TOOLS, TOOL_DESCRIPTIONS, toolsApplyTo } from "@/lib/skills/tools";
import { Button, Card, Checkbox, Field, Icon, Notice, Spinner, inputClass } from "@/components/ui";

/**
 * Create and edit are the same form: a skill is small enough that splitting
 * them would only duplicate the tool list. What differs is the scope control,
 * which is a choice on create and a fact afterwards — moving a skill between
 * products would silently change which runs can see it.
 */

const KIND_LABEL: Record<SkillKind, string> = { research: "Research", outreach: "Outreach" };

const KIND_HINT: Record<SkillKind, string> = {
  research: "How the loop finds and scores",
  outreach: "How the email is written",
};

const ALL_KINDS: SkillKind[] = ["research", "outreach"];

export function SkillForm({
  skill,
  products,
  backTo,
}: {
  /** Undefined creates a new skill. */
  skill?: Skill;
  products: { id: string; name: string }[];
  backTo: string;
}) {
  const router = useRouter();
  const creating = !skill;

  const [name, setName] = useState(skill?.name ?? "");
  const [kinds, setKinds] = useState<SkillKind[]>(
    skill?.kinds?.length ? ALL_KINDS.filter((item) => skill.kinds.includes(item)) : ["research"]
  );
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [tools, setTools] = useState<string[]>(skill?.toolAllowlist ?? []);
  const [productId, setProductId] = useState<string | null>(skill?.productId ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Both halves may be ticked, but a skill nothing is ticked for would never be
  // resolved into a run, so at least one is required.
  const canSubmit = Boolean(name.trim() && instructions.trim() && kinds.length > 0);

  // Kept in ALL_KINDS order so "Research + Outreach" never reads back reversed.
  const toggleKind = (kind: SkillKind) =>
    setKinds((prev) =>
      prev.includes(kind)
        ? prev.filter((item) => item !== kind)
        : ALL_KINDS.filter((item) => item === kind || prev.includes(item))
    );

  const research = kinds.includes("research");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const body = {
        name: name.trim(),
        kinds,
        instructions: instructions.trim(),
        // An outreach-only skill never reaches the tool layer, so it saves empty.
        toolAllowlist: toolsApplyTo(kinds) ? tools : [],
      };

      const response = await fetch(creating ? "/api/skills" : `/api/skills/${skill.id}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creating ? { ...body, productId } : body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save that skill");

      router.push(backTo);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!skill) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete that skill");
      }
      router.push(backTo);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  const scopeName = skill?.productId
    ? (products.find((product) => product.id === skill.productId)?.name ?? "one product")
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card padding="lg">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !busy) void submit();
          }}
        >
          <Field label="Name" htmlFor="skill-name" hint="What it will be called in the picker.">
            <input
              id="skill-name"
              className={inputClass}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Follow funding and growth"
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Applies to</span>
            <p className="mb-3 text-[13px] leading-relaxed text-ink-3">
              Tick both to use the same instructions in the research loop and in the drafting nodes.
            </p>
            <div className="flex gap-2">
              {ALL_KINDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => toggleKind(option)}
                  aria-pressed={kinds.includes(option)}
                  className={`flex-1 rounded-[10px] border px-4 py-2.5 text-left transition-colors ${
                    kinds.includes(option)
                      ? "border-accent bg-accent-tint text-ink"
                      : "border-line-strong bg-surface text-ink-2 hover:bg-surface-sunken"
                  }`}
                >
                  <span className="block text-[14px] font-medium">{KIND_LABEL[option]}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-3">{KIND_HINT[option]}</span>
                </button>
              ))}
            </div>
            {kinds.length === 0 && (
              <p className="mt-2 text-[12px] text-ink-3">Pick at least one, or it never runs.</p>
            )}
          </div>

          <Field
            label="Instructions"
            htmlFor="skill-instructions"
            hint="Added to the prompt verbatim. The first line is what the picker shows underneath the name."
          >
            <textarea
              id="skill-instructions"
              rows={14}
              className={`${inputClass} resize-y leading-relaxed`}
              value={instructions}
              disabled={busy}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={
                research
                  ? "Target companies in a spending window.\n\n- Weight recent funding rounds and headcount growth.\n- Recency matters more than size."
                  : "Open on the specific thing you observed about this company.\n\n- Sentence one is the signal.\n- Under 120 words."
              }
            />
          </Field>

          {toolsApplyTo(kinds) ? (
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Tools</span>
              <p className="mb-3 text-[13px] leading-relaxed text-ink-3">
                Leave every box clear to allow all of them. Ticking some restricts the run to
                exactly those, across every skill selected for it.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_TOOLS.map((tool) => (
                  <label
                    key={tool}
                    className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5 transition-colors hover:bg-surface-sunken"
                  >
                    <Checkbox
                      checked={tools.includes(tool)}
                      label={tool}
                      onChange={(next) =>
                        setTools((prev) =>
                          next ? [...prev, tool] : prev.filter((item) => item !== tool)
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{tool}</span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                        {TOOL_DESCRIPTIONS[tool]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <Notice tone="neutral">
              Outreach drafting does not call tools, so an outreach-only skill is its instructions
              alone.
            </Notice>
          )}

          {creating && (
            <Field
              label="Available to"
              htmlFor="skill-scope"
              hint="This cannot be changed later — it decides which runs can see the skill."
            >
              <select
                id="skill-scope"
                className={inputClass}
                value={productId ?? ""}
                disabled={busy}
                onChange={(event) => setProductId(event.target.value || null)}
              >
                <option value="">Every product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} only
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <Notice tone="bad">{error}</Notice>}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <Button type="submit" variant="primary" size="lg" disabled={!canSubmit || busy}>
              {busy ? <Spinner /> : <Icon.Check />}
              {creating ? "Create skill" : "Save changes"}
            </Button>
            <Link href={backTo}>
              <Button variant="ghost" size="lg" disabled={busy}>
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>

      <aside className="space-y-6">
        <Card padding="md">
          <h2 className="text-[14px] font-semibold">Where this lands</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {whereThisLands(kinds)}
          </p>
          <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Applies to</dt>
              <dd className="font-medium">
                {kinds.length === 0 ? "—" : kinds.map((item) => KIND_LABEL[item]).join(" + ")}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Tools allowed</dt>
              <dd className="tabular font-medium">
                {!toolsApplyTo(kinds) ? "—" : tools.length === 0 ? "All" : tools.length}
              </dd>
            </div>
            {!creating && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Available to</dt>
                <dd className="min-w-0 truncate font-medium">{scopeName ?? "Every product"}</dd>
              </div>
            )}
          </dl>
        </Card>

        {!creating && (
          <Card padding="md">
            <h2 className="text-[14px] font-semibold">Delete</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Runs that already used this skill keep their results and stay readable. It only stops
              being offered for new ones.
            </p>
            {confirmingDelete ? (
              <div className="mt-4 flex items-center gap-2">
                <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Icon.Trash className="h-4 w-4" />}
                  Delete for good
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <Button variant="danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                  <Icon.Trash className="h-4 w-4" />
                  Delete this skill
                </Button>
              </div>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

/** Both halves ticked means the instructions land in both sets of nodes. */
function whereThisLands(kinds: SkillKind[]): string {
  const research =
    "The instructions join the system prompt of the planning, search and scoring nodes. Tools ticked here are the only ones those nodes may call.";
  const outreach =
    "The instructions join the system prompt of the drafting and critique nodes, alongside the product profile.";
  if (kinds.includes("research") && kinds.includes("outreach")) return `${research} ${outreach}`;
  if (kinds.includes("outreach")) return outreach;
  return research;
}
