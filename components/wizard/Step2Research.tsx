"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductProfile, Skill } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  Icon,
  Notice,
  Pill,
  SectionHeading,
  Spinner,
  Stepper,
  Tag,
  inputClass,
} from "@/components/ui";
import { StepFrame } from "@/components/wizard/StepFrame";
import { RunMonitor } from "@/components/wizard/RunMonitor";
import { RunList, type RunSummaryView } from "@/components/wizard/RunSwitcher";
import { useRunStream } from "@/components/useRunStream";
import Link from "next/link";

const MAX_LEADS = 10;

/**
 * The Research phase: configure a run, then watch it.
 *
 * Both halves live here because they are the same phase of the same run. The
 * configuration surface stays small on purpose — lead count, skills, anything
 * extra worth reading. The budget controls are real and stay available, but
 * folded away: they are a safeguard, not a decision most runs need to make.
 */
export function Step2Research({
  productId,
  profile,
  skills,
  runId,
  targetCount: runTargetCount,
  runs,
  onBack,
  onStarted,
  onContinue,
  startConfiguring = false,
}: {
  productId: string;
  profile: ProductProfile | null;
  skills: Skill[];
  /** The run being watched, if this phase already has one. */
  runId: string | undefined;
  targetCount: number;
  /** Every run this product has had, so they can be found and reopened. */
  runs: RunSummaryView[];
  onBack: () => void;
  onStarted: (runId: string, targetCount: number) => void;
  onContinue: () => void;
  /** Open on the form even though a run exists — someone asked for a new one. */
  startConfiguring?: boolean;
}) {
  const [targetCount, setTargetCount] = useState(runTargetCount || 5);
  /*
   * A run already on this phase is something to watch, not something to set up
   * again, so the form is behind a deliberate "new run" rather than being the
   * default view of a product that has already been researched.
   */
  const [configuring, setConfiguring] = useState(startConfiguring);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [budgetCandidates, setBudgetCandidates] = useState(120);
  const [budgetSeconds, setBudgetSeconds] = useState(600);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Only research skills reach this loop; an outreach-only one would be resolved
  // away and silently do nothing, so it is not offered here.
  const researchSkills = skills.filter((skill) => skill.kinds.includes("research"));

  // Derived rather than pruned on edit: a skill deleted from the manager drops
  // out of the run payload without any state to keep in step.
  const liveSelection = selectedSkills.filter((id) =>
    researchSkills.some((skill) => skill.id === id)
  );

  async function attachLink(value: string) {
    setAttaching(true);
    try {
      const uri = value.includes("://") ? value : `https://${value}`;
      const response = await fetch(`/api/products/${productId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "link", uri }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not attach that link");
      }
      setLinks((prev) => [...new Set([...prev, uri])]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  async function attachFile(file: File) {
    setAttaching(true);
    setError("");
    try {
      const created = await fetch(`/api/products/${productId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "pdf",
          filename: file.name,
          mimeType: file.type || "application/pdf",
          sizeBytes: file.size,
        }),
      });
      const data = await created.json();
      if (!created.ok) throw new Error(data.error ?? "Could not start the upload");

      const put = await fetch(data.upload.url, {
        method: "PUT",
        headers: data.upload.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const completed = await fetch(
        `/api/products/${productId}/sources/${data.source.id}/complete`,
        { method: "POST" }
      );
      if (!completed.ok) {
        const result = await completed.json().catch(() => ({}));
        throw new Error(result.error ?? "Could not read that file");
      }
      setAttached((prev) => [...prev, file.name]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  async function run() {
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId,
          targetCount,
          useProfile: true,
          skillIds: liveSelection,
          budgetCandidates,
          budgetSeconds,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the run");
      onStarted(data.runId, targetCount);
    } catch (caught) {
      setError((caught as Error).message);
      setStarting(false);
    }
  }

  /*
   * Only subscribe while the monitor is on screen. Asking for the stream of a
   * run you are in the middle of replacing would replay the old run's
   * transcript underneath the form for the new one.
   */
  const watching = Boolean(runId) && !configuring;
  const stream = useRunStream(watching ? runId : undefined, targetCount);
  const running = watching && stream.status === "running";

  if (watching && runId) {
    return (
      <StepFrame
        step={2}
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Review leads"
        continueHint={running ? "Leads are reviewable as they arrive" : undefined}
        secondaryAction={
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setConfiguring(true)}
            disabled={running}
            title={running ? "This run is still going" : undefined}
          >
            <Icon.Search />
            New run
          </Button>
        }
      >
        <RunMonitor
          runId={runId}
          stream={stream}
          running={running}
          targetCount={targetCount}
          foundCount={0}
        />
        <div className="mt-10">
          <RunList productId={productId} runs={runs} currentRunId={runId} />
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step={2}
      /* Backing out of the form returns to the run it was going to replace. */
      onBack={runId ? () => setConfiguring(false) : onBack}
      hideNav={false}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card padding="lg">
            <SectionHeading
              number="01"
              title="How many leads"
              description="Each one is researched, enriched and scored individually, so this is the main thing that sets what a run costs."
            />
            <div className="flex flex-wrap items-center gap-4">
              <Stepper value={targetCount} onChange={setTargetCount} min={1} max={MAX_LEADS} label="Lead count" />
              <p className="text-[13px] text-ink-3">Up to {MAX_LEADS} per run.</p>
            </div>
          </Card>

          <Card padding="lg">
            <SectionHeading
              number="02"
              title="Skills"
              description="A skill is an instruction block plus the tools it may use. Selecting one changes how the loop searches and scores — no prompt editing."
              actions={
                <Link
                  href={`/admin/skills?from=${encodeURIComponent(
                    `/admin/products/${productId}?step=2`
                  )}`}
                  className="flex h-8 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-sunken"
                >
                  <Icon.Sliders className="h-4 w-4" />
                  Manage
                </Link>
              }
            />
            <SkillPicker
              skills={researchSkills}
              selected={liveSelection}
              onChange={setSelectedSkills}
            />
          </Card>

          <Card padding="lg">
            <SectionHeading
              number="03"
              title="Additional context"
              description="Optional. Anything here is read and attached to the product, so later runs keep it too."
            />
            <div className="space-y-4">
              <Field label="Link" htmlFor="extra-link" hint="Press Enter to attach.">
                <input
                  id="extra-link"
                  className={inputClass}
                  value={linkDraft}
                  disabled={attaching}
                  onChange={(event) => setLinkDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const value = linkDraft.trim();
                    if (!value) return;
                    void attachLink(value);
                    setLinkDraft("");
                  }}
                  placeholder="https://a-relevant-report.com"
                />
              </Field>

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface-sunken px-4 py-4 text-[14px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-tint hover:text-ink">
                {attaching ? <Spinner className="h-4 w-4" /> : <Icon.Upload className="h-4 w-4" />}
                {attaching ? "Attaching…" : "Attach a PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  disabled={attaching}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void attachFile(file);
                    event.target.value = "";
                  }}
                />
              </label>

              {(links.length > 0 || attached.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {links.map((link) => (
                    <Tag key={link}>{link.replace(/^https?:\/\//, "")}</Tag>
                  ))}
                  {attached.map((file) => (
                    <Tag key={file}>{file}</Tag>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <div>
            <button
              type="button"
              onClick={() => setAdvanced((prev) => !prev)}
              aria-expanded={advanced}
              className="flex items-center gap-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              <Icon.Chevron className={`h-3.5 w-3.5 transition-transform ${advanced ? "rotate-180" : ""}`} />
              Budget limits
            </button>
            {advanced && (
              <Card padding="md" className="mt-3">
                <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
                  A run stops cleanly at whichever limit it reaches first, returns what it found, and
                  says so. Without these, a narrow ICP loops until the credits are gone.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Candidates examined" hint="Hard cap on how many get researched.">
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      step={10}
                      className={`${inputClass} tabular`}
                      value={budgetCandidates}
                      onChange={(event) => setBudgetCandidates(Number(event.target.value) || 120)}
                    />
                  </Field>
                  <Field label="Wall clock (seconds)" hint="Stops the loop even if it is still finding things.">
                    <input
                      type="number"
                      min={30}
                      max={3600}
                      step={30}
                      className={`${inputClass} tabular`}
                      value={budgetSeconds}
                      onChange={(event) => setBudgetSeconds(Number(event.target.value) || 600)}
                    />
                  </Field>
                </div>
              </Card>
            )}
          </div>

          {error && <Notice tone="bad">{error}</Notice>}

          <Button variant="primary" size="lg" onClick={run} disabled={starting} fullWidth>
            {starting ? <Spinner /> : <Icon.Search />}
            {starting ? "Starting the run…" : `Run research for ${targetCount} lead${targetCount === 1 ? "" : "s"}`}
          </Button>
        </div>

        <aside className="space-y-6">
          <Card padding="md">
            <h3 className="text-[14px] font-semibold">Searching against</h3>
            {profile ? (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{profile.icp.summary}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {profile.icp.industries.slice(0, 6).map((industry) => (
                    <Pill key={industry}>{industry}</Pill>
                  ))}
                </div>
                <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Profile version</dt>
                    <dd className="tabular font-medium">v{profile.version}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Scoring criteria</dt>
                    <dd className="tabular font-medium">{profile.scoringCriteria.length}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Disqualifiers</dt>
                    <dd className="tabular font-medium">{profile.disqualifiers.length}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Qualifying bar</dt>
                    <dd className="tabular font-medium">60%</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-ink-3">No profile loaded.</p>
            )}
          </Card>

          <RunList productId={productId} runs={runs} currentRunId={runId ?? null} />
        </aside>
      </div>

    </StepFrame>
  );
}

/** Multi-select dropdown. The backend accepts up to five skills per run. */
function SkillPicker({
  skills,
  selected,
  onChange,
}: {
  skills: Skill[];
  selected: string[];
  onChange: (ids: string[]) => void;
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

  const chosen = skills.filter((skill) => selected.includes(skill.id));
  const label =
    chosen.length === 0
      ? "Default behaviour"
      : chosen.length === 1
        ? chosen[0].name
        : `${chosen.length} skills selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${inputClass} flex items-center justify-between gap-3 text-left`}
      >
        <span className={chosen.length === 0 ? "text-ink-3" : "text-ink"}>{label}</span>
        <Icon.Chevron className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-[12px] border border-line bg-surface shadow-raised"
        >
          {skills.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-ink-3">No skills available.</p>
          )}
          {skills.map((skill) => {
            const on = selected.includes(skill.id);
            const atLimit = selected.length >= 5 && !on;
            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={on}
                disabled={atLimit}
                onClick={() =>
                  onChange(on ? selected.filter((id) => id !== skill.id) : [...selected, skill.id])
                }
                className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-sunken disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
                    on ? "border-accent bg-accent text-white" : "border-line-strong"
                  }`}
                >
                  {on && <Icon.Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{skill.name}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">
                    {skill.instructions.split("\n")[0]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chosen.map((skill) => (
            <Tag key={skill.id} onRemove={() => onChange(selected.filter((id) => id !== skill.id))}>
              {skill.name}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
