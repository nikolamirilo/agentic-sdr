"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ProductProfile } from "@/lib/types";
import {
  Button,
  Card,
  Tabs,
  TabPanel,
  Field,
  Icon,
  Notice,
  Pill,
  SectionHeading,
  Spinner,
  inputClass,
} from "@/components/ui";
import { StepFrame } from "@/components/wizard/StepFrame";
import { readSse } from "@/components/readSse";

export type ProductSummary = {
  id: string;
  name: string;
  websiteUrl: string | null;
  /** null when the product has no profile yet. */
  profileVersion?: number | null;
  leadCount?: number;
};

export type SourceSummary = {
  id: string;
  kind: string;
  uri: string | null;
  status: string;
};

type NodeLine = { node: string; label: string; summary: string };

/**
 * Step one is now only about the profile. Registering the product and attaching
 * its first material happens before the flow starts, which keeps this step to a
 * single question: is the profile right?
 */
export function Step1Profile({
  productId,
  profile,
  sources,
  onProfileChanged,
  onContinue,
}: {
  productId: string;
  profile: ProductProfile | null;
  sources: SourceSummary[];
  onProfileChanged: (profile: ProductProfile) => void;
  onContinue: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [lines, setLines] = useState<NodeLine[]>([]);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    setWorking(true);
    setError("");
    setLines([]);
    setStatusText("Reading your material…");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/products/${productId}/profile`, {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Generation failed (${response.status})`);
      }

      await readSse(response, (event, data) => {
        if (event === "node") {
          const node = String(data.node);
          setStatusText(String(data.label));
          setLines((prev) => [
            ...prev.filter((l) => l.node !== node),
            { node, label: String(data.label), summary: String(data.summary ?? "") },
          ]);
        } else if (event === "done") {
          onProfileChanged(data.profile as ProductProfile);
        } else if (event === "error") {
          throw new Error(String(data.message ?? "Generation failed"));
        }
      });
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError((caught as Error).message);
    } finally {
      setWorking(false);
      abortRef.current = null;
    }
  }, [productId, onProfileChanged]);

  return (
    <StepFrame
      step={1}
      onContinue={profile ? onContinue : undefined}
      continueLabel="Continue to research"
      continueHint={profile ? undefined : "Generate a profile to continue"}
    >
      {working && <GenerationProgress statusText={statusText} lines={lines} />}

      {!working && !profile && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card padding="lg">
            <SectionHeading
              number="01"
              title="Generate the profile"
              description="We read everything attached to this product, plus a little market research, then write the definition, ICP, domain language, disqualifiers and scoring criteria."
            />

            {error && (
              <div className="mb-5">
                <Notice tone="bad">{error}</Notice>
              </div>
            )}

            {sources.length === 0 ? (
              <Notice tone="warn" title="Nothing to read yet">
                This product has no website, links or documents attached. Add something in step two,
                or register the product again with a site.
              </Notice>
            ) : (
              <Button variant="primary" size="lg" onClick={generate}>
                <Icon.Spark />
                Generate profile
              </Button>
            )}
          </Card>

          <SourcesCard sources={sources} />
        </div>
      )}

      {!working && profile && (
        <ProfileSections
          productId={productId}
          profile={profile}
          onSaved={onProfileChanged}
          onRegenerate={generate}
          error={error}
        />
      )}
    </StepFrame>
  );
}

function SourcesCard({ sources }: { sources: SourceSummary[] }) {
  return (
    <Card padding="md">
      <h3 className="text-[14px] font-semibold">What we will read</h3>
      {sources.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">Nothing attached yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sources.map((source) => (
            <li key={source.id} className="flex items-start gap-2.5 text-[13px]">
              <span className="mt-0.5 shrink-0 text-ink-3">
                {source.kind === "pdf" ? (
                  <Icon.Document className="h-3.5 w-3.5" />
                ) : (
                  <Icon.Link className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-2" title={source.uri ?? ""}>
                {(source.uri ?? source.id).replace(/^https?:\/\//, "")}
              </span>
              {source.status === "failed" && <Pill tone="bad">failed</Pill>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GenerationProgress({ statusText, lines }: { statusText: string; lines: NodeLine[] }) {
  return (
    <Card padding="lg">
      <div className="flex items-center gap-3">
        <Spinner className="h-5 w-5 text-accent" />
        <p className="text-[17px] font-medium">{statusText || "Working…"}</p>
      </div>
      <p className="mt-2 text-[14px] text-ink-2">
        This takes a minute or two. Leaving this page does not stop it, but you will need to
        regenerate to see the steps again.
      </p>

      <ol className="mt-6 space-y-1">
        {lines.map((line) => (
          <li
            key={line.node}
            className="row-in flex items-baseline gap-3 border-b border-line py-2.5 last:border-0"
          >
            <Icon.Check className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />
            <span className="min-w-0 flex-1 text-[14px] font-medium">{line.label}</span>
            <span className="shrink-0 text-[13px] text-ink-3">{line.summary || "done"}</span>
          </li>
        ))}
        {lines.length === 0 && (
          <li className="space-y-2 py-2">
            <div className="shimmer h-4 w-2/3 rounded-[6px]" />
            <div className="shimmer h-4 w-1/2 rounded-[6px]" />
          </li>
        )}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------- profile sections */

function ProfileSections({
  productId,
  profile,
  onSaved,
  onRegenerate,
  error,
}: {
  productId: string;
  profile: ProductProfile;
  onSaved: (profile: ProductProfile) => void;
  onRegenerate: () => void;
  error: string;
}) {
  const [draft, setDraft] = useState(profile);
  const [active, setActive] = useState("definition");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/products/${productId}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productDefinition: tidy(draft.productDefinition),
          icp: tidy(draft.icp),
          domainKnowledge: tidy(draft.domainKnowledge),
          domainLanguage: draft.domainLanguage,
          disqualifiers: draft.disqualifiers,
          scoringCriteria: draft.scoringCriteria,
          exampleEmails: draft.exampleEmails,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save");
      onSaved(data.profile);
      setDraft(data.profile);
    } catch (caught) {
      setSaveError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const totalWeight = draft.scoringCriteria.reduce((sum, c) => sum + c.weight, 0);

  const tabs = [
    { id: "definition", number: "01", title: "Product Definition" },
    { id: "icp", number: "02", title: "ICP Definition" },
    { id: "knowledge", number: "03", title: "Domain Knowledge" },
    {
      id: "language",
      number: "04",
      title: "Domain Language",
      badge: draft.domainLanguage.terms.length,
    },
    { id: "disqualifiers", number: "05", title: "Disqualifiers", badge: draft.disqualifiers.length },
    {
      id: "criteria",
      number: "06",
      title: "Scoring Criteria",
      badge: draft.scoringCriteria.length,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">Version {draft.version}</Pill>
          <Pill>{draft.domainLanguage.terms.length} terms with evidence</Pill>
          <Pill>{draft.scoringCriteria.length} scoring criteria</Pill>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onRegenerate} variant="ghost" size="sm">
            Regenerate
          </Button>
          <Button
            onClick={save}
            variant={dirty ? "primary" : "secondary"}
            size="sm"
            disabled={!dirty || saving}
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {dirty ? "Save as new version" : "Saved"}
          </Button>
        </div>
      </div>

      {(error || saveError) && <Notice tone="bad">{error || saveError}</Notice>}

      <div className="space-y-5">
        <Tabs tabs={tabs} active={active} onSelect={setActive} label="Profile sections" />

        <TabPanel id={active}>
          {active === "definition" && (
            <div className="space-y-5">
              <Field label="One-liner">
                <input
                  className={inputClass}
                  value={draft.productDefinition.oneLiner}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      productDefinition: { ...draft.productDefinition, oneLiner: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="What it does">
                <AutoTextarea
                  className={`${inputClass} min-h-24`}
                  value={draft.productDefinition.whatItDoes}
                  onChange={(whatItDoes) =>
                    setDraft({
                      ...draft,
                      productDefinition: { ...draft.productDefinition, whatItDoes },
                    })
                  }
                />
              </Field>
              <ListEditor
                label="Capabilities"
                hint="What the product actually does, one capability per row."
                values={draft.productDefinition.capabilities}
                onChange={(capabilities) =>
                  setDraft({
                    ...draft,
                    productDefinition: { ...draft.productDefinition, capabilities },
                  })
                }
              />
              <ListEditor
                label="Problems solved"
                hint="The pain a buyer feels before this product exists."
                values={draft.productDefinition.problemsSolved}
                onChange={(problemsSolved) =>
                  setDraft({
                    ...draft,
                    productDefinition: { ...draft.productDefinition, problemsSolved },
                  })
                }
              />
              <ListEditor
                label="Differentiators"
                hint="Why this and not the obvious alternative."
                values={draft.productDefinition.differentiators}
                onChange={(differentiators) =>
                  setDraft({
                    ...draft,
                    productDefinition: { ...draft.productDefinition, differentiators },
                  })
                }
              />
              <Field label="Pricing model">
                <AutoTextarea
                  className={`${inputClass} min-h-16`}
                  value={draft.productDefinition.pricingModel ?? ""}
                  onChange={(pricingModel) =>
                    setDraft({
                      ...draft,
                      productDefinition: { ...draft.productDefinition, pricingModel },
                    })
                  }
                />
              </Field>
            </div>
          )}

          {active === "icp" && (
            <div className="space-y-5">
              <Field
                label="Summary"
                hint="Narrow enough to search against. “Companies that want to grow” is not."
              >
                <AutoTextarea
                  className={`${inputClass} min-h-24`}
                  value={draft.icp.summary}
                  onChange={(summary) => setDraft({ ...draft, icp: { ...draft.icp, summary } })}
                />
              </Field>
              <Field label="Company size">
                <input
                  className={inputClass}
                  value={draft.icp.companySize}
                  onChange={(event) =>
                    setDraft({ ...draft, icp: { ...draft.icp, companySize: event.target.value } })
                  }
                />
              </Field>
              <ListEditor
                label="Company types"
                values={draft.icp.companyTypes}
                onChange={(companyTypes) => setDraft({ ...draft, icp: { ...draft.icp, companyTypes } })}
              />
              <div className="grid gap-5 lg:grid-cols-2">
                <ListEditor
                  label="Industries"
                  values={draft.icp.industries}
                  onChange={(industries) => setDraft({ ...draft, icp: { ...draft.icp, industries } })}
                />
                <ListEditor
                  label="Buyer roles"
                  values={draft.icp.buyerRoles}
                  onChange={(buyerRoles) => setDraft({ ...draft, icp: { ...draft.icp, buyerRoles } })}
                />
              </div>
              <ListEditor
                label="Trigger signals"
                hint="Events that mean a company is in the market right now."
                values={draft.icp.triggerSignals}
                onChange={(triggerSignals) =>
                  setDraft({ ...draft, icp: { ...draft.icp, triggerSignals } })
                }
              />
              <div className="grid gap-5 lg:grid-cols-2">
                <ListEditor
                  label="Geographies"
                  values={draft.icp.geographies}
                  onChange={(geographies) => setDraft({ ...draft, icp: { ...draft.icp, geographies } })}
                />
                <ListEditor
                  label="Example customers"
                  hint="URLs of companies that already look like the target."
                  values={draft.icp.exampleCustomerUrls}
                  onChange={(exampleCustomerUrls) =>
                    setDraft({ ...draft, icp: { ...draft.icp, exampleCustomerUrls } })
                  }
                />
              </div>
            </div>
          )}

          {active === "knowledge" && (
            <div className="space-y-5">
              <Field label="Market summary">
                <AutoTextarea
                  className={`${inputClass} min-h-24`}
                  value={draft.domainKnowledge.marketSummary}
                  onChange={(marketSummary) =>
                    setDraft({
                      ...draft,
                      domainKnowledge: { ...draft.domainKnowledge, marketSummary },
                    })
                  }
                />
              </Field>
              <ListEditor
                label="Pain points"
                values={draft.domainKnowledge.painPoints}
                onChange={(painPoints) =>
                  setDraft({ ...draft, domainKnowledge: { ...draft.domainKnowledge, painPoints } })
                }
              />
              <ListEditor
                label="Common workflows"
                values={draft.domainKnowledge.commonWorkflows}
                onChange={(commonWorkflows) =>
                  setDraft({ ...draft, domainKnowledge: { ...draft.domainKnowledge, commonWorkflows } })
                }
              />
              <ListEditor
                label="Competitors"
                values={draft.domainKnowledge.competitors}
                onChange={(competitors) =>
                  setDraft({ ...draft, domainKnowledge: { ...draft.domainKnowledge, competitors } })
                }
              />
            </div>
          )}

          {active === "language" && (
            <div>
              <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
                Every term was found word-for-word in a source we read, and links to where. Terms with no
                evidence were dropped — that is what keeps this from becoming generic marketing vocabulary.
              </p>
              {draft.domainLanguage.terms.length === 0 ? (
                <p className="text-[14px] text-ink-3">No terms survived verification.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {draft.domainLanguage.terms.map((term) => (
                    <span
                      key={term.term}
                      className="inline-flex items-center gap-2 rounded-[8px] border border-line bg-surface-sunken py-1.5 pl-3 pr-2 text-[13px]"
                      title={term.meaning}
                    >
                      <span className="font-medium text-ink">{term.term}</span>
                      <a
                        href={term.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Evidence for ${term.term}`}
                        className="text-ink-3 transition-colors hover:text-accent"
                      >
                        <Icon.External className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        aria-label={`Remove ${term.term}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            domainLanguage: {
                              terms: draft.domainLanguage.terms.filter((t) => t.term !== term.term),
                            },
                          })
                        }
                        className="text-ink-3 transition-colors hover:text-bad"
                      >
                        <Icon.Close className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {active === "disqualifiers" && (
            <div>
              <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
                Reasons to stop, not reasons to score lower. A candidate matching any of these is dropped.
              </p>
              <ul className="space-y-2">
                {draft.disqualifiers.map((rule, index) => (
                  <li
                    key={rule.id}
                    className="flex items-start gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5 transition-colors focus-within:border-accent hover:border-line-strong"
                  >
                    <span className="section-number shrink-0 pt-2">{rule.id}</span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <AutoTextarea
                        value={rule.rule}
                        ariaLabel={`Rule ${rule.id}`}
                        placeholder="The rule"
                        onChange={(next) => {
                          const disqualifiers = [...draft.disqualifiers];
                          disqualifiers[index] = { ...rule, rule: next };
                          setDraft({ ...draft, disqualifiers });
                        }}
                        className="w-full border-0 bg-transparent px-1 py-1 text-[14px] font-medium leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
                      />
                      <AutoTextarea
                        value={rule.rationale}
                        ariaLabel={`Why rule ${rule.id} exists`}
                        placeholder="Why it disqualifies"
                        onChange={(next) => {
                          const disqualifiers = [...draft.disqualifiers];
                          disqualifiers[index] = { ...rule, rationale: next };
                          setDraft({ ...draft, disqualifiers });
                        }}
                        className="w-full border-0 bg-transparent px-1 py-1 text-[13px] leading-relaxed text-ink-3 placeholder:text-ink-3 focus:outline-none"
                      />
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove rule ${rule.id}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          disqualifiers: draft.disqualifiers.filter((d) => d.id !== rule.id),
                        })
                      }
                      className="mt-2 shrink-0 text-ink-3 transition-colors hover:text-bad"
                    >
                      <Icon.Close className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {draft.disqualifiers.length === 0 && (
                  <li className="text-[14px] text-ink-3">
                    No disqualifiers. Every candidate will be scored.
                  </li>
                )}
              </ul>
            </div>
          )}

          {active === "criteria" && (
            <div>
              <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
                Yes-or-no questions answerable from a candidate&rsquo;s public footprint. A lead needs 60%
                of the total weight to qualify, which is what makes the bar in step three mean something.
              </p>
              <ul className="space-y-2.5">
                {draft.scoringCriteria.map((criterion, index) => (
                  <li
                    key={criterion.id}
                    className="rounded-[10px] border border-line bg-surface px-3.5 py-3 transition-colors focus-within:border-accent hover:border-line-strong"
                  >
                    <div className="mb-1.5 flex items-center gap-3">
                      <span className="section-number shrink-0 uppercase">{criterion.id}</span>
                      <span className="h-px flex-1 bg-line" aria-hidden />
                      <WeightPicker
                        value={criterion.weight}
                        label={`Weight for ${criterion.id}`}
                        onChange={(weight) => {
                          const next = [...draft.scoringCriteria];
                          next[index] = { ...criterion, weight };
                          setDraft({ ...draft, scoringCriteria: next });
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${criterion.id}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            scoringCriteria: draft.scoringCriteria.filter((_, i) => i !== index),
                          })
                        }
                        className="shrink-0 text-ink-3 transition-colors hover:text-bad"
                      >
                        <Icon.Close className="h-4 w-4" />
                      </button>
                    </div>
                    <AutoTextarea
                      value={criterion.question}
                      ariaLabel={`Question for ${criterion.id}`}
                      onChange={(question) => {
                        const next = [...draft.scoringCriteria];
                        next[index] = { ...criterion, question };
                        setDraft({ ...draft, scoringCriteria: next });
                      }}
                      className="w-full border-0 bg-transparent px-0 py-0 text-[14px] leading-relaxed text-ink focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] text-ink-3">
                Total weight <span className="tabular font-medium text-ink-2">{totalWeight}</span>. A
                candidate needs{" "}
                <span className="tabular font-medium text-ink-2">{(totalWeight * 0.6).toFixed(1)}</span> to
                become a lead.
              </p>
            </div>
          )}
        </TabPanel>
      </div>
    </div>
  );
}

/**
 * Weight is a 1-to-5 scale, and a bare number box says none of that. Five
 * buttons show the whole range, mark where this criterion sits on it, and take
 * one click to change — which matters when you are balancing nine of them
 * against each other.
 */
function WeightPicker({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 items-center gap-1.5"
    >
      <span className="hidden text-[12px] text-ink-3 sm:inline">Weight</span>
      <span className="flex items-center gap-0.5 rounded-[8px] border border-line bg-surface-sunken p-0.5">
        {[1, 2, 3, 4, 5].map((weight) => (
          <button
            key={weight}
            type="button"
            role="radio"
            aria-checked={value === weight}
            aria-label={`${weight}`}
            onClick={() => onChange(weight)}
            className={`tabular h-6 w-6 rounded-[6px] text-[12px] font-medium transition-colors duration-150 ${
              value === weight
                ? "bg-accent text-white"
                : "text-ink-3 hover:bg-surface hover:text-ink"
            }`}
          >
            {weight}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * A textarea that grows with its content. Profile entries run from three words
 * to three lines, and a fixed box either wastes space or hides the end of the
 * sentence — neither of which you want when you are checking the model's work.
 */
function AutoTextarea({
  value,
  onChange,
  className = "",
  placeholder,
  ariaLabel,
  onKeyDown,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}

/**
 * Lists are the shape most of this profile actually has. One row per entry,
 * each row fully visible and independently editable, with a bulk mode for when
 * you would rather paste a block than click eight times.
 */
/** Trims every string list in a section and drops the rows left empty. */
function tidy<T extends Record<string, unknown>>(section: T): T {
  const out: Record<string, unknown> = { ...section };
  for (const [key, value] of Object.entries(section)) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      out[key] = (value as string[]).map((item) => item.trim()).filter(Boolean);
    }
  }
  return out as T;
}

function ListEditor({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[] | undefined;
  onChange: (values: string[]) => void;
}) {
  const items = values ?? [];
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [focusLast, setFocusLast] = useState(false);

  const clean = (next: string[]) => next.map((line) => line.trim()).filter(Boolean);

  function update(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function add() {
    setFocusLast(true);
    onChange([...items, ""]);
  }

  function remove(index: number) {
    setFocusLast(false);
    onChange(items.filter((_, i) => i !== index));
  }

  function openBulk() {
    setBulkText(items.join("\n"));
    setBulk(true);
  }

  function applyBulk() {
    onChange(clean(bulkText.split("\n")));
    setBulk(false);
  }

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <label className="text-[13px] font-medium text-ink">
          {label}
          <span className="tabular ml-2 font-normal text-ink-3">{items.length}</span>
        </label>
        <button
          type="button"
          onClick={() => (bulk ? applyBulk() : openBulk())}
          className="text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
        >
          {bulk ? "Apply" : "Bulk edit"}
        </button>
      </div>

      {bulk ? (
        <AutoTextarea
          value={bulkText}
          onChange={setBulkText}
          ariaLabel={`${label}, one per line`}
          className={`${inputClass} min-h-32 text-[14px] leading-relaxed`}
        />
      ) : (
        <ul className="space-y-1.5">
          {items.map((value, index) => (
            <li
              key={index}
              className="flex items-start gap-2 rounded-[10px] border border-line bg-surface-sunken px-2.5 py-1.5 transition-colors focus-within:border-accent hover:border-line-strong"
            >
              <span className="section-number w-5 shrink-0 pt-2 text-right">{index + 1}</span>
              <AutoTextarea
                value={value}
                onChange={(next) => update(index, next)}
                ariaLabel={`${label} ${index + 1}`}
                placeholder="Empty — write something or remove the row"
                autoFocus={focusLast && index === items.length - 1}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    add();
                  }
                }}
                className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
              />
              <button
                type="button"
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => remove(index)}
                className="mt-1.5 shrink-0 text-ink-3 transition-colors hover:text-bad"
              >
                <Icon.Close className="h-4 w-4" />
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="rounded-[10px] border border-dashed border-line-strong px-3 py-3 text-[13px] text-ink-3">
              Nothing here yet.
            </li>
          )}
        </ul>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        {bulk ? (
          <p className="text-[13px] text-ink-3">One per line. Blank lines are dropped.</p>
        ) : (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-accent"
          >
            <Icon.Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {hint && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{hint}</p>}
    </div>
  );
}
