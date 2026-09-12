"use client";

import { useState } from "react";

const MODES = {
  agent: {
    tab: "Agent decides",
    type: "Warm intro",
    reason: "A hiring signal that matches this ICP's trigger",
    benefit: "Cuts the research half of their week",
  },
  override: {
    tab: "You override",
    type: "Direct pitch",
    reason: "Your own line, verbatim",
    benefit: "Your own line, verbatim",
  },
} satisfies Record<string, { tab: string; type: string; reason: string; benefit: string }>;

type ModeKey = keyof typeof MODES;

/** The one truly interactive piece on the page: click through to feel the default-vs-override split described in the copy above it. */
export function OutreachDemo() {
  const [mode, setMode] = useState<ModeKey>("agent");
  const active = MODES[mode];

  return (
    <div>
      <div className="inline-flex rounded-[10px] border border-line-strong bg-surface p-1">
        {(Object.keys(MODES) as ModeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
              mode === key ? "bg-accent text-white" : "text-ink-2 hover:text-ink"
            }`}
          >
            {MODES[key].tab}
          </button>
        ))}
      </div>

      <div key={mode} className="step-in mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Type" value={active.type} />
        <Field label="Reason" value={active.reason} />
        <Field label="Benefit" value={active.benefit} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface-sunken px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{value}</p>
    </div>
  );
}
