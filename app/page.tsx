import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import {
  Button,
  Card,
  Pill,
  RelevanceBadge,
  IconArrowRight,
  IconCheck,
  IconDocument,
  IconSliders,
  IconUpload,
  IconSpark,
  IconPencil,
  IconSearch,
  IconMail,
} from "@/components/ui";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { SignalOrbit } from "@/components/SignalOrbit";
import { PipelineLoop } from "@/components/PipelineLoop";
import { OutreachDemo } from "@/components/OutreachDemo";

export const metadata: Metadata = {
  title: "SignalFit",
  description:
    "A product context layer that any GTM agent can use. The SDR is the first thing built on top of it.",
};

/* -------------------------------------------------------------- section shell */

function Eyebrow({ number, children }: { number: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="section-number">{number}</span>
      <span className="h-px w-10 bg-line-strong" aria-hidden />
      <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {children}
      </span>
    </div>
  );
}

function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-20 py-20 lg:py-28 ${className}`}>
      <div className="mx-auto w-full max-w-[76rem] px-6 lg:px-10">{children}</div>
    </section>
  );
}

/** Feature/fact cards throughout lift slightly on hover, echoing the product-picker cards in /admin. */
function LiftCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Card
      padding="lg"
      className={`h-full transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-raised ${className}`}
    >
      {children}
    </Card>
  );
}

const NAV = [
  { href: "#why", label: "Why" },
  { href: "#journey", label: "How it works" },
  { href: "#profile", label: "Product Profile" },
  { href: "#research", label: "Research" },
  { href: "#outreach", label: "Outreach" },
  { href: "#pricing", label: "Pricing" },
];

const WHY: { title: string; body: string; icon: ComponentType<{ className?: string }> }[] = [
  {
    title: "Product only",
    body: "One profile, reusable across every campaign — not a list of accounts.",
    icon: IconDocument,
  },
  {
    title: "Skills",
    body: "Research and outreach are composed from named skills. Swap a skill, not a prompt.",
    icon: IconSliders,
  },
  {
    title: "Qualified only",
    body: "Loops until it hits your count. Nothing under 60% relevance reaches you.",
    icon: IconCheck,
  },
];

const JOURNEY: { title: string; body: string; icon: ComponentType<{ className?: string }> }[] = [
  { title: "Register the product", body: "Paste a URL, upload files.", icon: IconUpload },
  { title: "Generate the profile", body: "One run derives the full Product Profile.", icon: IconSpark },
  { title: "Read and edit it", body: "Your durable asset. Correct once, benefit always.", icon: IconPencil },
  { title: "Run research", body: "Up to 10 leads. The agent loops until it's done.", icon: IconSearch },
  { title: "Approve leads", body: "Each carries a signal and a relevance score.", icon: IconCheck },
  {
    title: "Set outreach, or don't",
    body: "The agent derives it from the profile by default.",
    icon: IconSliders,
  },
  { title: "Approve messages", body: "Nothing sends without you.", icon: IconDocument },
  { title: "Connect Gmail", body: "Sent from your address. Replies land in your inbox.", icon: IconMail },
];

const PROFILE_BLOCKS = [
  { title: "Product definition", from: ["Website", "Uploaded PDFs", "Company pages"] },
  { title: "ICP definition", from: ["Product definition", "Uploaded PDFs"] },
  { title: "Domain knowledge", from: ["Industry research", "Uploaded PDFs", "Links"] },
  { title: "Domain language", from: ["Your input", "Domain knowledge", "Industry talks", "Web research"] },
  { title: "Disqualifiers", from: ["Your input", "Product gaps", "Competitor lock-in"] },
];

const RESEARCH_RULES = [
  "Exclusion list is checked before scoring — no effort spent on known contacts.",
  "Disqualifiers drop candidates silently, mid-loop.",
  "Every run has a stop condition. A narrow ICP returns a partial result, not a hang.",
  "Relevance is yes/no criteria, never a free-form score that drifts upward.",
];

const OUTREACH_CARDS = [
  { title: "Derived from the profile", body: "Type, reason, and benefit of outreach — the agent decides by default. Override any of the three." },
  { title: "You approve every message", body: "One draft per lead. Nothing sends until you say so." },
  { title: "Gmail, send-only", body: "Your address, your reputation. No warmup, no sending infra." },
  { title: "Outcomes close the loop", body: "Contacted, replied, booked — feeds straight into the next profile version." },
];

const PRICING_CARDS = [
  { title: "Pay per found lead", body: "Ask for ten, get ten, pay for ten. Dead ends are our cost." },
  { title: "Flat fee for the profile", body: "Billed once — it's a durable asset, not a one-off." },
  { title: "Partial runs, partial bill", body: "Stop early on budget, pay only for what shipped." },
];

export default function Root() {
  return (
    <div className="min-h-screen overflow-x-clip">
      {/* --------------------------------------------------------- header */}
      <header className="sticky top-0 z-10 border-b border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[76rem] items-center justify-between gap-4 px-6 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5">
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
          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <Link href="/admin">
            <Button variant="primary" size="sm">
              Open the app
              <IconArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* ----------------------------------------------------------- hero */}
      <Section className="relative pb-16 pt-16 lg:pb-24 lg:pt-24">
        {/*
         * A quiet radial fade behind the headline only — greyscale, not the
         * accent colour, since navy is reserved for the primary action.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(60%_55%_at_20%_0%,rgba(11,11,12,0.05),transparent)]"
        />

        <div className="flex flex-col items-start gap-14 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-3xl">
            <Reveal>
              <Pill tone="accent">B2B · product context layer</Pill>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="display mt-6 text-ink">
                A product context layer that any GTM agent can use.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="subhead mt-5 max-w-xl">
                The SDR is the first thing built on top of it. More qualified pipeline, without
                the spam — the agent charges only for leads you approve.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/admin">
                  <Button variant="primary" size="lg">
                    Get started
                    <IconArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <a href="#journey">
                  <Button variant="secondary" size="lg">
                    See how it works
                  </Button>
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={200} className="hidden shrink-0 lg:block">
            <SignalOrbit />
          </Reveal>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {[
            {
              key: "relevance",
              stat: <CountUp target={60} suffix="%" />,
              body: "Minimum relevance. Nothing below it reaches you.",
            },
            {
              key: "leads",
              stat: <CountUp target={10} />,
              body: "Max leads per run — the agent loops until it has them.",
            },
            {
              key: "pricing",
              stat: "Per lead",
              body: "Pricing follows delivery. Search effort is our cost.",
            },
          ].map((item, i) => (
            <Reveal key={item.key} delay={320 + i * 80}>
              <LiftCard>
                <p className="tabular text-[30px] font-semibold leading-none tracking-[-0.01em] text-ink">
                  {item.stat}
                </p>
                <p className="mt-2.5 text-[13px] leading-relaxed text-ink-3">{item.body}</p>
              </LiftCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* --------------------------------------------------------- why */}
      <Section id="why" className="on-dark border-t border-line-strong bg-surface-sunken">
        <Reveal>
          <Eyebrow number="01">Why this is different</Eyebrow>
          <h2 className="headline max-w-2xl text-ink">
            Most AI SDRs generate volume from thin context. Buyers can tell.
          </h2>
          <p className="subhead mt-4 max-w-2xl">
            SignalFit builds a Product Profile first — a durable, editable artifact every
            research and outreach run reads from.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {WHY.map((item, i) => (
            <Reveal key={item.title} delay={i * 90}>
              <LiftCard>
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-tint">
                  <item.icon className="h-4 w-4 text-accent" />
                </div>
                <h3 className="mt-4 text-[17px] font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{item.body}</p>
              </LiftCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------- journey */}
      <Section id="journey" className="border-t border-line bg-surface">
        <Reveal>
          <Eyebrow number="02">User journey</Eyebrow>
          <h2 className="headline max-w-2xl text-ink">
            From a URL to a message in someone&rsquo;s inbox.
          </h2>
        </Reveal>

        <ol className="mt-12 grid gap-x-8 gap-y-9 md:grid-cols-2">
          {JOURNEY.map((step, i) => (
            <Reveal key={step.title} delay={(i % 4) * 70}>
              <li className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface">
                  <step.icon className="h-4 w-4 text-accent" />
                </span>
                <div>
                  <span className="section-number">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-0.5 text-[15px] font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{step.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------- profile */}
      <Section id="profile" className="border-t border-line-strong bg-surface-sunken">
        <Reveal>
          <Eyebrow number="03">Product Profile</Eyebrow>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="headline max-w-2xl text-ink">
              The core asset. Generated once, edited by you, versioned.
            </h2>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">
              <span className="pulse-soft h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              v3 · live
            </span>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PROFILE_BLOCKS.map((block, i) => (
            <Reveal key={block.title} delay={i * 80}>
              <LiftCard className="flex flex-col">
                <h3 className="text-[15px] font-semibold text-ink">{block.title}</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {block.from.map((item) => (
                    <span
                      key={item}
                      className="rounded-[7px] border border-line bg-surface-sunken px-2 py-1 text-[12px] leading-none text-ink-2"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </LiftCard>
            </Reveal>
          ))}
          <Reveal delay={PROFILE_BLOCKS.length * 80}>
            <LiftCard className="flex flex-col justify-center bg-accent-tint">
              <h3 className="text-[15px] font-semibold text-accent">Disqualifiers stay invisible</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                They drop bad-fit candidates inside the search — even when the ICP matches.
              </p>
            </LiftCard>
          </Reveal>
        </div>
      </Section>

      {/* ------------------------------------------------------ research */}
      <Section id="research" className="border-t border-line bg-surface">
        <Reveal>
          <Eyebrow number="04">Research</Eyebrow>
          <h2 className="headline max-w-2xl text-ink">
            The agent loops until it has enough, not until it runs out.
          </h2>
        </Reveal>

        <Reveal delay={80}>
          <Card padding="lg" className="mt-10">
            <PipelineLoop />
          </Card>
        </Reveal>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <Reveal delay={160}>
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Rules</p>
            <ul className="mt-4 space-y-3">
              {RESEARCH_RULES.map((rule) => (
                <li key={rule} className="flex gap-3">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="text-[14px] leading-relaxed text-ink-2">{rule}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={240}>
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Per qualified lead
            </p>
            <LiftCard className="mt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-ink">Full name · title</p>
                  <p className="mt-1 text-[13px] text-ink-3">Email · phone if available · profile link</p>
                </div>
                <RelevanceBadge value={0.82} />
              </div>
              <div className="mt-4 rounded-[10px] border border-line bg-surface-sunken px-3.5 py-3">
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
                  Signal
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  Why this lead fits, tied to a specific fact.
                </p>
              </div>
            </LiftCard>
          </Reveal>
        </div>
      </Section>

      {/* ------------------------------------------------------ outreach */}
      <Section id="outreach" className="border-t border-line-strong bg-surface-sunken">
        <Reveal>
          <Eyebrow number="05">Outreach</Eyebrow>
          <h2 className="headline max-w-2xl text-ink">
            Sent from your own mailbox. Nothing without your approval.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {OUTREACH_CARDS.map((card, i) => (
            <Reveal key={card.title} delay={i * 80}>
              <LiftCard>
                <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{card.body}</p>
              </LiftCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={OUTREACH_CARDS.length * 80}>
          <Card padding="lg" className="mt-6">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Try it — outreach parameters
            </p>
            <div className="mt-4">
              <OutreachDemo />
            </div>
          </Card>
        </Reveal>

        <Reveal delay={OUTREACH_CARDS.length * 80 + 80}>
          <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            Read scopes need an annual Google security assessment, so v1 stays send-only —
            no inbox reading, no warmup, no sending infrastructure of our own.
          </p>
        </Reveal>
      </Section>

      {/* ------------------------------------------------------- pricing */}
      <Section id="pricing" className="border-t border-line bg-surface">
        <Reveal>
          <Eyebrow number="06">Pricing</Eyebrow>
          <h2 className="headline max-w-2xl text-ink">
            You pay for leads that clear the bar, not for the search.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {PRICING_CARDS.map((card, i) => (
            <Reveal key={card.title} delay={i * 90}>
              <LiftCard>
                <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{card.body}</p>
              </LiftCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={PRICING_CARDS.length * 90}>
          <Card padding="lg" className="mt-6 border-accent-line bg-accent-tint">
            <p className="text-[14px] leading-relaxed text-ink-2">
              <span className="font-semibold text-accent">Worth watching:</span> billing per
              qualified lead creates an incentive to loosen the bar over time, so the scoring
              criteria stay visible in the Product Profile — yours to audit, yours to adjust.
            </p>
          </Card>
        </Reveal>
      </Section>

      {/* ---------------------------------------------------------- cta */}
      <Section className="on-dark border-t border-line-strong bg-surface-sunken">
        <Reveal>
          <img
            src="/human-agent-collab.svg"
            alt=""
            className="mx-auto mb-10 h-auto w-full max-w-xl"
          />
        </Reveal>
        <Reveal delay={80}>
          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-xl">
              <h2 className="headline text-ink">Register your product. Read the profile it builds.</h2>
              <p className="subhead mt-3">Decide what leaves your inbox.</p>
            </div>
            <Link href="/admin" className="shrink-0">
              <Button variant="primary" size="lg">
                Get started
                <IconArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Reveal>
      </Section>

      {/* ------------------------------------------------------- footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-2 px-6 py-8 text-[13px] text-ink-3 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <span>SignalFit</span>
          <span>A product context layer that any GTM agent can use.</span>
        </div>
      </footer>
    </div>
  );
}
