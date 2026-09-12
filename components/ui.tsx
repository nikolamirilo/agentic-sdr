"use client";

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ icons */
/*
 * Minimal 1.5px stroke icons on a 24 grid. No fills, no illustration, nothing
 * that reads as decoration — they exist to label a control, not to entertain.
 */

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ className = "h-4 w-4", children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

export const Icon = {
  ArrowRight: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  ArrowLeft: (p: IconProps) => (
    <Svg {...p}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Minus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  Chevron: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  ),
  Link: (p: IconProps) => (
    <Svg {...p}>
      <path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1" />
    </Svg>
  ),
  Document: (p: IconProps) => (
    <Svg {...p}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  ),
  Upload: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </Svg>
  ),
  Mail: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </Svg>
  ),
  Phone: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 3h3l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v3a2 2 0 01-2 2A16 16 0 014 5a2 2 0 012-2z" />
    </Svg>
  ),
  External: (p: IconProps) => (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </Svg>
  ),
  Search: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Svg>
  ),
  Sort: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 4v16M7 20l-3-3M7 20l3-3" />
      <path d="M17 20V4M17 4l-3 3M17 4l3 3" />
    </Svg>
  ),
  Spark: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </Svg>
  ),
  Warning: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 4l8.5 15h-17z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  ),
  Pencil: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  ),
  Trash: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h16M10 7V5a1 1 0 011-1h2a1 1 0 011 1v2" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
    </Svg>
  ),
  Sliders: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Svg>
  ),
};

/*
 * Server Components cannot reach an icon through `Icon.Foo`: each export of a
 * "use client" module becomes its own client reference, and a property lookup
 * on an exported object is not one. Client components can keep using the `Icon`
 * namespace; anything rendered on the server imports these directly.
 */
export const IconArrowRight = Icon.ArrowRight;
export const IconArrowLeft = Icon.ArrowLeft;
export const IconPlus = Icon.Plus;
export const IconCheck = Icon.Check;
export const IconSpark = Icon.Spark;
export const IconExternal = Icon.External;

/* --------------------------------------------------------------- buttons */

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  title?: string;
  fullWidth?: boolean;
  "aria-label"?: string;
};

export function Button({
  children,
  onClick,
  type = "button",
  variant = "secondary",
  size = "md",
  disabled,
  title,
  fullWidth,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] border font-medium transition-[background-color,border-color,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40";

  const sizes = {
    sm: "h-8 px-3 text-[13px]",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-[15px]",
  }[size];

  const variants = {
    primary: "border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover",
    secondary: "border-line-strong bg-surface text-ink hover:bg-surface-sunken",
    ghost: "border-transparent bg-transparent text-ink-2 hover:bg-surface-sunken hover:text-ink",
    danger: "border-transparent bg-transparent text-bad hover:bg-bad-tint",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants} ${fullWidth ? "w-full" : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- cards */

export function Card({
  children,
  className = "",
  padding = "md",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  interactive?: boolean;
}) {
  const pad = { none: "", sm: "p-4", md: "p-6", lg: "p-8" }[padding];
  return (
    <div
      className={`rounded-[16px] border border-line bg-surface shadow-card ${pad} ${
        interactive ? "transition-colors duration-150 hover:border-line-strong" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The structural device carried across all five steps: a two-digit number,
 * then the heading, then optional supporting text.
 */
export function SectionHeading({
  number,
  title,
  description,
  actions,
}: {
  number: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <div className="mb-2 flex items-center gap-3">
          <span className="section-number">{number}</span>
          <span className="h-px w-8 bg-line-strong" aria-hidden />
        </div>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const inputClass =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 focus:border-accent focus:outline-none disabled:bg-surface-sunken disabled:text-ink-3";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{hint}</p>}
    </div>
  );
}

/** Number stepper. Typing is allowed, but the buttons are the primary control. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 10,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  const clamp = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div className="inline-flex items-center gap-1 rounded-[10px] border border-line-strong bg-surface p-1">
      <button
        type="button"
        onClick={() => clamp(value - 1)}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-[7px] text-ink-2 transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Icon.Minus />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(event) => clamp(Number(event.target.value) || min)}
        className="tabular w-14 border-0 bg-transparent text-center text-[17px] font-semibold text-ink [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => clamp(value + 1)}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-[7px] text-ink-2 transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Icon.Plus />
      </button>
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-150 ${
        checked
          ? "border-accent bg-accent text-white"
          : "border-line-strong bg-surface hover:border-ink-3"
      }`}
    >
      {checked && <Icon.Check className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ pills */

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-surface-sunken text-ink-2",
  good: "border-transparent bg-good-tint text-good",
  warn: "border-transparent bg-warn-tint text-warn",
  bad: "border-transparent bg-bad-tint text-bad",
  info: "border-transparent bg-info-tint text-info",
  accent: "border-accent-line bg-accent-tint text-accent",
};

export function Pill({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium leading-none ${TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Relevance reads green at 80%+, amber between 60 and 80. Below 60 never ships. */
export function RelevanceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone: Tone = pct >= 80 ? "good" : pct >= 60 ? "warn" : "neutral";
  return (
    <Pill tone={tone}>
      <span className="tabular font-semibold">{pct}%</span>
      <span className="font-normal opacity-70">relevance</span>
    </Pill>
  );
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-line bg-surface-sunken px-2.5 py-1 text-[13px] text-ink">
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="text-ink-3 transition-colors hover:text-bad"
        >
          <Icon.Close className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- feedback */

export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  if (!children && !title) return null;
  const border = {
    neutral: "border-line",
    good: "border-good/25",
    warn: "border-warn/25",
    bad: "border-bad/25",
    info: "border-accent-line",
    accent: "border-accent-line",
  }[tone];
  const bg = {
    neutral: "bg-surface-sunken",
    good: "bg-good-tint",
    warn: "bg-warn-tint",
    bad: "bg-bad-tint",
    info: "bg-info-tint",
    accent: "bg-accent-tint",
  }[tone];
  const text = {
    neutral: "text-ink-2",
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
    info: "text-info",
    accent: "text-accent",
  }[tone];

  return (
    <div className={`rounded-[12px] border px-4 py-3 text-[14px] leading-relaxed ${border} ${bg} ${text}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1 opacity-90" : ""}>{children}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-ink-3">{children}</p>}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`shimmer rounded-[6px] ${className}`} />;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------ disclosure */

export function Expandable({
  number,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  number: string;
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-surface-sunken"
      >
        <span className="section-number shrink-0">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {summary && !open && (
            <span className="mt-0.5 block truncate text-[13px] text-ink-3">{summary}</span>
          )}
        </span>
        <Icon.Chevron
          className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-line px-5 py-5">{children}</div>}
    </div>
  );
}
