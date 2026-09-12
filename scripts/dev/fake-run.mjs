// `npm run fake-run <productId>` — drives the streaming spine with no model,
// no Exa and no Firecrawl. This is how you test SSE, resume-after-refresh and
// the progress UI without spending money or waiting on a real loop.
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const connectionString =
  process.env.DATABASE_URL || process.env.NEON_PG_DB_CONNECTION_STRING;
const pool = new pg.Pool({ connectionString, max: 2 });

const productId = process.argv[2];
if (!productId) {
  const { rows } = await pool.query("select id, name from products order by created_at desc limit 5");
  console.error("Usage: npm run fake-run <productId>");
  if (rows.length > 0) {
    console.error("\nProducts:");
    for (const row of rows) console.error(`  ${row.id}  ${row.name}`);
  } else {
    console.error("\nNo products yet. Create one in the UI first.");
  }
  await pool.end();
  process.exit(1);
}

const TARGET = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { rows: runRows } = await pool.query(
  `insert into research_runs (product_id, profile_id, target_count, budget_candidates, budget_seconds, use_profile)
   values ($1, null, $2, 60, 300, true) returning id`,
  [productId, TARGET]
);
const runId = runRows[0].id;
console.log(`run ${runId}`);
console.log(`watch: http://localhost:3000/products/${productId}/research`);

let seq = 0;
async function emit(kind, payload) {
  seq += 1;
  await pool.query(
    `insert into run_events (run_id, seq, kind, payload) values ($1, $2, $3, $4::jsonb)`,
    [runId, seq, kind, JSON.stringify(payload)]
  );
  console.log(`  ${String(seq).padStart(2)} ${kind.padEnd(9)} ${payload.label ?? payload.node ?? ""} ${payload.detail ?? ""}`);
}

const COMPANIES = [
  ["Northwind Retail", "hiring two performance marketers, listed last week"],
  ["Bellweather Goods", "migrated to a headless storefront in March"],
  ["Copperline Supply", "raised a $12M Series A, announced 9 days ago"],
  ["Marrow & Co", "opened a second distribution centre in Leeds"],
  ["Tidewater Brands", "published a job post for a lifecycle marketing lead"],
];

let found = 0;
let examined = 0;

await emit("progress", { node: "start", label: "Starting", detail: `targeting ${TARGET} leads`, target: TARGET });
await sleep(600);

for (let turn = 0; turn < 3 && found < TARGET; turn += 1) {
  await emit("progress", {
    node: "plan_queries",
    label: "Planning search",
    detail: turn === 0 ? "3 queries from the ICP" : "3 rewritten queries",
  });
  await sleep(700);

  const discovered = 14 + turn * 6;
  await emit("progress", { node: "discover", label: "Discovering", detail: `examined ${discovered}` });
  await sleep(700);

  await emit("progress", { node: "dedupe", label: "Deduping", detail: `${discovered - 4} new, 4 already seen` });
  await sleep(500);

  await emit("progress", { node: "enrich", label: "Enriching", detail: "12 in flight" });
  await sleep(1100);

  examined += discovered;
  const qualified = Math.min(2, TARGET - found);
  await emit("progress", {
    node: "score",
    label: "Scoring",
    detail: `${qualified} qualified, ${discovered - qualified} below bar`,
  });
  await sleep(600);

  for (let i = 0; i < discovered - qualified && i < 3; i += 1) {
    await emit("candidate", {
      company: `Candidate ${turn}-${i}`,
      verdict: "below_threshold",
      relevance: 0.2 + i * 0.12,
      reason: 'scored 0.44, failed "Does the company run paid marketing campaigns?"',
    });
  }

  await emit("progress", { node: "filter", label: "Filtering", detail: `${qualified} cleared the 60% bar` });
  await sleep(400);

  for (let i = 0; i < qualified; i += 1) {
    const [company, signal] = COMPANIES[found % COMPANIES.length];
    found += 1;
    await emit("lead", {
      lead: {
        id: `fake-${runId}-${found}`,
        fullName: `Contact ${found}`,
        company,
        email: found % 3 === 0 ? null : `contact${found}@${company.toLowerCase().replace(/[^a-z]/g, "")}.com`,
        profileUrl: `https://${company.toLowerCase().replace(/[^a-z]/g, "")}.com/about`,
        signal,
        relevance: 0.62 + (found % 4) * 0.08,
        contactResolved: found % 3 !== 0,
      },
    });
    await sleep(350);
  }

  await pool.query(`update research_runs set found_count = $2, examined_count = $3 where id = $1`, [
    runId,
    found,
    examined,
  ]);
  await emit("progress", {
    node: "accumulate",
    label: "Qualifying",
    detail: `found ${found} of ${TARGET}`,
    found,
    target: TARGET,
    examined,
  });
  await sleep(500);

  if (found < TARGET) {
    const detail =
      turn === 0
        ? "segment too broad, narrowing to mid-market retail"
        : "most rejections failed the paid-marketing criterion, moving to DTC brands";
    await emit("progress", { node: "refine_queries", label: "Refining search", detail });
    await emit("reasoning", {
      node: "refine_queries",
      diagnosis: "78% of rejections failed the same criterion, so the segment is wrong, not the wording.",
      decision: detail,
      queries: ["mid-market DTC retail brands running paid social in-house"],
    });
    await sleep(900);
  }
}

const status = found >= TARGET ? "done" : "partial";
await pool.query(
  `update research_runs set status = $2, found_count = $3, examined_count = $4, finished_at = now() where id = $1`,
  [runId, status, found, examined]
);
await emit("done", {
  status,
  found,
  target: TARGET,
  examined,
  reason: status === "done" ? `found ${found} of ${TARGET}` : "budget reached",
});

console.log(`\n${status}: ${found}/${TARGET} after ${examined} candidates`);
await pool.end();
