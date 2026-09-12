# Product SDR

Research a product once, then run a loop that finds the people who need it and drafts the
email that reaches them.

One repo, one deployable Node service. The research loop runs in process, writes progress
rows to Postgres, and the browser reads those rows over SSE — so a run takes minutes, costs
real money, and survives a closed laptop lid.

---

## Running it

```bash
cp .env.example .env      # fill in DATABASE_URL, a model key, EXA_API_KEY, FIRECRAWL_API_KEY
                          # optional: UP2DATA_API_KEY for the LinkedIn search
npm install
npm run migrate           # idempotent; safe to re-run
npm run doctor            # checks every external dependency before you need it
npm run dev
```

`npm run doctor` is the first thing to run when something is wrong. The most common failure
in this app is a missing or dead key, not broken code, and it names which one.

### Without a model key

Everything except generation still works, and the streaming spine can be exercised on its
own:

```bash
npm run fake-run <productId>
```

That inserts a run and emits `run_events` on a timer. Open the product's research page and
watch it, then refresh mid-run — the stream resumes from the last `seq` you saw.

---

## How it fits together

```
Browser (Next.js App Router, Tailwind)
   |  POST /api/runs            -> returns run_id in under 100ms
   |  GET  /api/runs/:id/stream -> SSE, tails run_events
   v
Next.js server (Node runtime, long lived)
   |
   +-- LangGraph JS        profileGraph | researchGraph | outreachGraph
   |                       checkpointer: PostgresSaver
   +-- Tool layer          Exa (discovery) | Firecrawl (extraction)
   |                       Up2Data (LinkedIn people + firmographics)
   |                       enrichment (contacts) | Gmail (sending)
   +-- Vercel AI SDK       structured generation, one model layer
   v
Neon Postgres              profiles, runs, candidates, leads, messages,
                           run_events, checkpoints
```

The single load-bearing decision: **the research loop runs in process and writes progress
to Postgres; the browser reads those rows.** No job queue, no worker service, no pub sub,
and the client can disconnect without killing the run.

### The three graphs

**Profile** (`lib/graphs/profile/`) — fans out across the website, uploaded PDFs and a
little market research, then derives the product definition, ICP, domain language,
disqualifiers and scoring criteria. Writes version 1; every edit writes N+1.

**Research** (`lib/graphs/research/`) — the loop:

```
plan_queries -> discover -> dedupe -> enrich -> score -> filter -> accumulate -> check_done
                   ^                                                                |
                   +------------------------ refine_queries <-------- no -----------+
```

**Outreach** (`lib/graphs/outreach/`) — `load_context -> decide_angle -> draft -> critique
-> revise -> (interrupt: approval) -> send`. The approval is a real LangGraph `interrupt`:
the graph pauses, its state sits in the checkpointer, and a later HTTP request resumes it
at `send`.

---

## The parts that carry the weight

**`refine_queries` is what makes this an agent rather than a for loop.** It reads why
candidates were rejected and changes the search accordingly. When most candidates fail the
*same* criterion, that means the search is pointed at the wrong segment, so it changes the
segment instead of rewording the query. Its reasoning is logged and shown in the UI.

**Scoring is weighted yes-or-no questions, never a free-form score.** Ask a model for "a
relevance score out of ten" and it returns eight every time, and then everything clears the
bar. Relevance is `sum(weights of criteria met) / sum(all weights)`, the gate is 0.60, and
a question the model skipped counts as a no.

**Domain language is verified, not trusted.** A term survives only if it appears verbatim
in scraped source text, and it carries the URL it was seen on. Terms with no evidence are
dropped. This is what stops the field from becoming generic marketing vocabulary.

**`identity_key` is the dedupe spine.** One normalized string per human: lowercased email,
else normalized profile URL, else `slug(domain):slug(name)`. It is computed *before*
enrichment, because enrichment is the expensive step. Written to `candidates`, `leads` and
`exclusions` alike, so one indexed lookup answers "have we seen this person".

**Cost order is the node order.** Dedupe first, cheap heuristic filter inside it, enrich
third, model scoring last. Getting that order wrong multiplies the cost of a run by ten.

**Every run carries a hard budget** — candidates examined, wall clock, and token spend.
On hitting one the run finishes cleanly with status `partial`, returns what it found, and
says so plainly.

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Readiness, and which providers have credentials configured |
| GET POST | `/api/products` | List / register a product |
| GET POST | `/api/products/:id/sources` | List sources, or get a presigned upload URL |
| POST | `/api/products/:id/sources/:sid/complete` | Confirm upload, extract text |
| GET | `/api/products/:id/profile` | Current version |
| POST | `/api/products/:id/profile` | Generate, streams node transitions |
| PATCH | `/api/products/:id/profile` | Edit, writes a new version |
| GET POST | `/api/runs` | List runs / start research, returns `runId` |
| GET DELETE | `/api/runs/:id` | Status snapshot / stop cleanly |
| GET | `/api/runs/:id/stream` | SSE progress, resumable via `?afterSeq=` |
| GET | `/api/runs/:id/leads` | Qualified leads only |
| GET POST | `/api/outreach` | Read drafts / draft messages for leads |
| POST | `/api/messages/:id/approve` | Resume the interrupted graph |
| POST | `/api/messages/:id/send` | Send via Gmail |
| GET | `/api/gmail/connect` \| `/api/gmail/callback` | OAuth |
| GET POST | `/api/skills` | Available skills / create one |
| GET PATCH DELETE | `/api/skills/:id` | Read, edit or delete a skill |

Every graph-invoking route runs on the Node runtime. LangGraph, the Postgres driver and the
Google client all need it.

---

## Skills

A skill is a named instruction block plus a tool allowlist, stored in `skills` and selected
per run. Instructions are concatenated into the system prompt of the nodes their kind maps
to; the tool layer filters available tools to the union of the allowlists. Behaviour changes
by selecting a different skill — no code change, no prompt editing.

The defaults in `lib/skills/defaults.ts` are seeded on boot, but only once each: the
`seeded_skills` table records which slugs have been planted, so a skill you edit survives a
restart, one you delete stays deleted, and a default added to the code later still arrives.

Skills are managed at `/admin/skills` — reachable from **Skills** in the header on every
screen, and from **Manage** next to the picker on step two. The list filters by kind and
searches names and instructions; each skill opens on its own page at
`/admin/skills/:id`, where it is edited and deleted. Links out of the flow carry a `from`
path so the way back is one click.

A skill is global (offered for every product) or scoped to one product. That is a choice on
create and fixed afterwards, since moving one would silently change which runs can see it;
the defaults are global. Editing a skill never rewrites a run that already used it — runs
resolve their skills at entry and keep what they resolved.

---

## Deploying to Render

`render.yaml` is the blueprint. Three things matter:

- **Use a paid instance.** Free services spin down when idle and the cold start will land in
  the middle of your demo.
- **Migrations run as `preDeployCommand`, not at boot**, so a bad migration fails the deploy
  rather than the process.
- **Use Neon's pooled connection string**, with a small `PG_POOL_MAX`. Render restarts drop
  connections and Neon's pooler is what should be holding them.

A deploy kills in-flight runs. `failStaleRuns` reconciles them on boot rather than leaving
rows stuck on `running` forever.

---

## The three search providers

Each one answers a different question, and the rule is enforced by keeping them behind
separate interfaces in `lib/providers/`:

| Provider | Answers | Takes | Costs |
| --- | --- | --- | --- |
| **Exa** | "who or what exists that matches this" | a natural-language query | per search |
| **Firecrawl** | "what does this specific page actually say" | a URL | per scrape |
| **Up2Data** | "who holds this role at this kind of company" | LinkedIn facets | 1 credit per page of 25, per enrich |

`plan_queries` writes the web queries *and* the LinkedIn facets from the same ICP, so the
two searches cut at the same buyers from different directions: Exa finds companies that have
been written about, LinkedIn finds the person holding the job today.

The LinkedIn half is optional. Without `UP2DATA_API_KEY` every node behaves exactly as it
did before — the search is skipped, not failed.

Three things worth knowing before turning it on:

- **A LinkedIn member page is the one page Firecrawl cannot read.** It is behind an auth wall
  and a scrape returns a login screen. `enrich` routes those candidates to Up2Data's profile
  endpoint instead, and the two never both run on the same candidate.
- **A LinkedIn person arrives with no company website**, because the search does not carry
  one. One company call resolves it, and that domain is what identity, contact lookup and the
  exclusion list all key on. Candidates that already have a domain skip the call.
- **Geography and industry facets are not wired up.** They take LinkedIn numeric ids and v1
  has no typeahead to turn a place name into one, so those cuts are left to the scoring
  criteria — which can read a location off the profile anyway.

Everything is billed pay-on-success: a private profile, a timeout or a rate limit costs
nothing, which is why `Up2DataError` only retries the statuses that were never charged for.
`npm run doctor` reports the tier and the remaining credit balance; that check is free.

---

## Known limits

- **Contact enrichment has no provider wired up by default.** Without `ENRICHMENT_API_URL`,
  contacts come only from what a page publishes, and a lead without one is marked unresolved
  rather than guessed at. A fabricated email is worse than a missing one. The interface is
  in `lib/providers/enrichment.ts` and a paid provider is a URL change.
- **LinkedIn search sources people, not situations.** The facets select on title and company
  size, which is who someone is rather than what just happened to them. The signal still has
  to come from the web queries or from the tenure and headcount the enrich step reads.
- **Object storage falls back to Postgres** when no S3-compatible credentials are set. It
  works, but it proxies bytes through the app server, which is the thing presigned URLs
  exist to avoid.
- **Gmail stays in OAuth testing mode** with demo accounts as test users. Production
  verification for the send scope takes weeks.
- **Runs do not survive a deploy.** They live in the web process on purpose — that is the
  tradeoff for having no queue. Moving the graphs to a background worker is the first thing
  to revisit.

## What to revisit after the hackathon

- Graphs move to a background worker; the web service only enqueues.
- `run_events` polling becomes `LISTEN/NOTIFY`.
- Reply tracking, which means the restricted Gmail scope and a security assessment.
- Row level security for real multi-tenancy.
- Outcome data feeding profile version N+1 — the feedback loop this version only records.
