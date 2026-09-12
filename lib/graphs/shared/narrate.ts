import { emit } from "@/lib/streaming/runEvents";

/**
 * Node narration, shared by the research loop and the outreach graph.
 *
 * Profile generation narrates from its route: one `NODE_LABELS` map, one
 * `summarize` per node, and every transition pushed down the wire with a human
 * label. That works because the profile graph is a DAG the route can stand
 * outside of and watch.
 *
 * The research loop cannot be narrated that way. It runs detached from any
 * request, it revisits the same nodes turn after turn, and the interesting part
 * is *why* it went round again — which is a thing only the node knows. So the
 * narration moves inside, and this is the piece that keeps it consistent:
 * one label vocabulary, one payload shape, a real duration on every node, and
 * the same line mirrored to the server log so a run is readable in the terminal
 * when nobody has a browser open.
 *
 * Every event lands in `run_events`, which is durable and resumable. That is the
 * whole reason a closed laptop lid does not cost you the log of a paid run.
 */

/** Human labels, in the same voice as the profile route's NODE_LABELS. */
export const RESEARCH_NODE_LABELS: Record<string, string> = {
  start: "Starting the run",
  plan_queries: "Planning the search",
  discover: "Discovering candidates",
  dedupe: "Checking the exclusion list",
  enrich: "Enriching candidates",
  score: "Scoring against the criteria",
  filter: "Applying the 60% bar",
  accumulate: "Qualifying leads",
  check_done: "Checking the stop condition",
  refine_queries: "Refining the search",
};

export const OUTREACH_NODE_LABELS: Record<string, string> = {
  load_context: "Loading the lead and profile",
  decide_angle: "Deciding the angle",
  draft: "Writing the draft",
  critique_draft: "Critiquing the draft",
  revise: "Applying the fixes",
  await_approval: "Waiting for approval",
  send: "Sending from Gmail",
};

export type GraphName = "research" | "outreach";

const LABELS: Record<GraphName, Record<string, string>> = {
  research: RESEARCH_NODE_LABELS,
  outreach: OUTREACH_NODE_LABELS,
};

export function labelFor(graph: GraphName, node: string): string {
  return LABELS[graph][node] ?? node;
}

type Extra = Record<string, unknown>;

/**
 * The narrator handed to a node. `start` and `end` bracket the node, `progress`
 * reports from inside a long one, `reasoning` records a decision worth auditing,
 * and `fail` records something that went wrong without ending the run.
 */
export type Narrator = {
  start(node: string, detail?: string, extra?: Extra): Promise<void>;
  progress(node: string, detail: string, extra?: Extra): Promise<void>;
  end(node: string, detail: string, extra?: Extra): Promise<void>;
  reasoning(node: string, detail: string, extra?: Extra): Promise<void>;
  fail(node: string, error: unknown, extra?: Extra): Promise<void>;
  /** Seconds since the narrator was created. The run's own clock. */
  elapsed(): number;
};

function human(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Builds a narrator bound to one run.
 *
 * `scope` is merged into every payload. Research passes nothing; outreach passes
 * the lead, because one drafting session narrates several leads through the same
 * nodes and a line without the lead on it is unreadable.
 */
export function narrator(
  runId: string | undefined,
  graph: GraphName,
  scope: Extra = {}
): Narrator {
  // Per-node start times, so `end` reports a duration nobody had to thread
  // through the node signature.
  const startedAt = new Map<string, number>();
  const bornAt = Date.now();
  const tag = `[${graph} ${runId ? runId.slice(0, 8) : "no-session"}]`;

  const say = (node: string, mark: string, detail: string, ms?: number) => {
    const suffix = ms === undefined ? "" : ` (${human(ms)})`;
    const who = typeof scope.leadName === "string" ? ` ${scope.leadName}:` : "";
    console.log(`${tag} ${mark} ${node}${who} ${detail}${suffix}`);
  };

  const write = async (
    kind: "node_start" | "node_end" | "progress" | "reasoning" | "error",
    node: string,
    detail: string,
    extra: Extra,
    ms?: number
  ) => {
    // A graph can be driven without a session — a script, a one-off invoke. It
    // still logs to the console; there is simply no stream to write to.
    if (!runId) return;
    await emit(runId, kind, {
      ...scope,
      ...extra,
      node,
      label: labelFor(graph, node),
      detail,
      graph,
      ...(ms === undefined ? {} : { ms: Math.round(ms), took: human(ms) }),
      elapsedMs: Date.now() - bornAt,
    });
  };

  return {
    async start(node, detail = "", extra = {}) {
      startedAt.set(node, Date.now());
      say(node, "→", detail || labelFor(graph, node));
      await write("node_start", node, detail, extra);
    },

    async progress(node, detail, extra = {}) {
      say(node, "·", detail);
      await write("progress", node, detail, extra);
    },

    async end(node, detail, extra = {}) {
      const began = startedAt.get(node);
      const ms = began === undefined ? undefined : Date.now() - began;
      startedAt.delete(node);
      say(node, "✓", detail, ms);
      // One row, one meaning: `node_end` is a node closing, `progress` is a tick
      // from inside one. Writing both for a close would double the event volume
      // of every run to say the same thing twice.
      await write("node_end", node, detail, extra, ms);
    },

    async reasoning(node, detail, extra = {}) {
      say(node, "?", detail);
      await write("reasoning", node, detail, extra);
    },

    async fail(node, error, extra = {}) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${tag} ✗ ${node} ${message}`);
      // fatal:false keeps the browser from tearing the view down — the loop is
      // designed so one dead URL or one bad page never ends a run.
      await write("error", node, message, { ...extra, fatal: false });
    },

    elapsed() {
      return (Date.now() - bornAt) / 1000;
    },
  };
}
