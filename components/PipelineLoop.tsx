/**
 * A stylised read of the research graph's node order (see
 * lib/graphs/research/graph.ts): a signal travels the track and the loop
 * back through "refine" is named below rather than drawn, since a literal
 * arrow-back at this size reads as clutter, not signal.
 */
const NODES = ["Discover", "Dedupe", "Enrich", "Score", "Filter", "Accumulate"];

export function PipelineLoop() {
  return (
    <div className="pb-9 pt-2">
      <div className="relative h-px w-full bg-line-strong">
        <span
          className="travel absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ boxShadow: "0 0 0 4px var(--accent-tint)" }}
          aria-hidden
        />
        {NODES.map((node, i) => (
          <div
            key={node}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(i / (NODES.length - 1)) * 100}%` }}
          >
            <span className="block h-2 w-2 rounded-full border-2 border-line-strong bg-surface" />
            <span className="absolute left-1/2 top-4 hidden -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-ink-2 sm:block">
              {node}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-3 sm:mt-8">
        Loops back through <span className="text-ink-2">refine queries</span> until it has
        enough qualified leads, or hits its budget.
      </p>
    </div>
  );
}
