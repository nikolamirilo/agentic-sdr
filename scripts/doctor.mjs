// `npm run doctor` — checks every external dependency before you need it.
// The most common way this app is broken is a missing or dead key, not code.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });
const pick = (...names) => names.map((n) => process.env[n]).find((v) => v && v.trim());

// --- database -------------------------------------------------------------
const connectionString = pick("DATABASE_URL", "NEON_PG_DB_CONNECTION_STRING");
if (!connectionString) {
  record("postgres", false, "DATABASE_URL is not set");
} else {
  try {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString, max: 1 });
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_tables where schemaname = 'public'"
    );
    const pooled = /-pooler\./.test(connectionString);
    record("postgres", true, `${rows[0].n} tables${pooled ? ", pooled endpoint" : ", DIRECT endpoint (prefer the pooled one)"}`);
    await pool.end();
  } catch (error) {
    record("postgres", false, error.message);
  }
}

// --- model provider -------------------------------------------------------
const xai = pick("XAI_API_KEY", "GROK_API_KEY");
const anthropic = pick("ANTHROPIC_API_KEY");
const openai = pick("OPENAI_API_KEY");

if (!xai && !anthropic && !openai) {
  record("model provider", false, "set XAI_API_KEY (or GROK_API_KEY), ANTHROPIC_API_KEY, or OPENAI_API_KEY");
} else {
  try {
    const { generateText } = await import("ai");
    let model;
    let label;
    if (xai) {
      const { createXai } = await import("@ai-sdk/xai");
      label = process.env.MODEL_ID || "grok-4.6";
      model = createXai({ apiKey: xai })(label);
    } else if (anthropic) {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      label = process.env.MODEL_ID || "claude-opus-5";
      model = createAnthropic({ apiKey: anthropic })(label);
    } else {
      const { createOpenAI } = await import("@ai-sdk/openai");
      label = process.env.MODEL_ID || "gpt-5";
      model = createOpenAI({ apiKey: openai })(label);
    }
    const result = await generateText({ model, prompt: "Reply with the single word: ok", maxRetries: 0 });
    record("model provider", true, `${label} responded (${result.text.trim().slice(0, 20)})`);
  } catch (error) {
    record("model provider", false, String(error.message).slice(0, 140));
  }
}

// --- exa ------------------------------------------------------------------
const exaKey = pick("EXA_API_KEY", "EXO_API_KEY");
if (!exaKey) record("exa", false, "EXA_API_KEY is not set");
else {
  try {
    const { default: Exa } = await import("exa-js");
    const found = await new Exa(exaKey).search("b2b saas companies", { numResults: 1 });
    record("exa", true, `search returned ${found.results.length} result(s)`);
  } catch (error) {
    record("exa", false, String(error.message).slice(0, 140));
  }
}

// --- firecrawl ------------------------------------------------------------
const firecrawlKey = pick("FIRECRAWL_API_KEY");
if (!firecrawlKey) record("firecrawl", false, "FIRECRAWL_API_KEY is not set");
else {
  try {
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const doc = await new Firecrawl({ apiKey: firecrawlKey }).scrape("https://example.com", {
      formats: ["markdown"],
    });
    record("firecrawl", true, `scraped ${(doc.markdown || "").length} chars`);
  } catch (error) {
    record("firecrawl", false, String(error.message).slice(0, 140));
  }
}

// --- up2data --------------------------------------------------------------
// GET /v1/account is free, so this proves the key without spending a credit.
const up2dataKey = pick("UP2DATA_API_KEY");
if (!up2dataKey) {
  record("up2data (linkedin)", false, "UP2DATA_API_KEY is not set — LinkedIn search is skipped");
} else {
  try {
    const response = await fetch("https://api.up2data.ai/v1/account", {
      headers: { "x-api-key": up2dataKey },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || response.statusText);
    const { tier, credits_remaining } = body.data ?? {};
    record("up2data (linkedin)", true, `${tier || "unknown"} tier, ${credits_remaining ?? "?"} credits remaining`);
  } catch (error) {
    record("up2data (linkedin)", false, String(error.message).slice(0, 140));
  }
}

// --- optional -------------------------------------------------------------
const storage =
  pick("NEON_STORAGE_BUCKET", "S3_BUCKET") && pick("NEON_STORAGE_ENDPOINT", "S3_ENDPOINT");
record("object storage", Boolean(storage), storage ? "configured" : "not configured — uploads use the Postgres fallback");

const gmail =
  pick("GOOGLE_CLIENT_ID") && pick("GOOGLE_CLIENT_SECRET") && pick("GOOGLE_REDIRECT_URI") && pick("TOKEN_ENCRYPTION_KEY");
record("gmail", Boolean(gmail), gmail ? "configured" : "not configured — drafting works, sending does not");

const enrichment = pick("ENRICHMENT_API_KEY") && pick("ENRICHMENT_API_URL");
record("contact enrichment", Boolean(enrichment), enrichment ? "configured" : "not configured — contacts come from page content only");

// --- report ---------------------------------------------------------------
const pad = Math.max(...results.map((r) => r.name.length));
let blocking = 0;
const REQUIRED = new Set(["postgres", "model provider", "exa", "firecrawl"]);

console.log("");
for (const { name, ok, detail } of results) {
  const required = REQUIRED.has(name);
  const mark = ok ? "ok  " : required ? "FAIL" : "--  ";
  if (!ok && required) blocking += 1;
  console.log(`${mark}  ${name.padEnd(pad)}  ${detail}`);
}
console.log("");

if (blocking > 0) {
  console.log(`${blocking} required dependency/dependencies are not working. Runs will fail.`);
  process.exitCode = 1;
} else {
  console.log("Everything required is working.");
}
