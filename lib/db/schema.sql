-- Product SDR schema. Idempotent: safe to run on every deploy.

create extension if not exists "pgcrypto";

-- a registered product, the top level tenant object
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  website_url   text,
  created_at    timestamptz not null default now()
);

-- raw ingested material, kept so profile regeneration does not re-scrape.
-- the file itself lives in object storage, this row points at it.
create table if not exists sources (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  kind          text not null,            -- website | pdf | link
  uri           text,                     -- original URL, null for uploads
  bucket        text,                     -- object storage bucket
  object_key    text,                     -- products/<id>/sources/<uuid>.pdf
  mime_type     text,
  size_bytes    bigint,
  raw_text      text,                     -- extracted text, kept in Postgres for querying
  checksum      text,
  status        text not null default 'pending',  -- pending | ready | failed
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists sources_product_checksum_idx on sources (product_id, checksum);

-- the core asset, versioned so edits never destroy history
create table if not exists product_profiles (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  version            int not null,
  product_definition jsonb not null,
  icp                jsonb not null,
  domain_knowledge   jsonb not null,
  domain_language    jsonb not null,      -- { terms: [{term, meaning, evidence_url}] }
  disqualifiers      jsonb not null,      -- [{ id, rule, rationale }]
  scoring_criteria   jsonb not null,      -- [{ id, question, weight }]
  example_emails     jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  unique (product_id, version)
);

create table if not exists research_runs (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  profile_id        uuid references product_profiles(id),
  target_count      int not null,
  status            text not null default 'running',  -- running | done | partial | failed
  found_count       int not null default 0,
  examined_count    int not null default 0,
  budget_candidates int not null default 120,
  budget_seconds    int not null default 600,
  use_profile       boolean not null default true,    -- false = control arm for the comparison view
  skill_ids         uuid[] not null default '{}',
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists research_runs_product_idx on research_runs (product_id, started_at desc);

-- everything the loop looked at, including rejections.
-- never shown to the user, used for dedupe, audit and billing defence.
create table if not exists candidates (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references research_runs(id) on delete cascade,
  product_id    uuid not null,
  identity_key  text not null,
  source_url    text,
  raw           jsonb,
  score         numeric,
  verdict       text not null,            -- qualified | below_threshold | disqualified | excluded | unresolved
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists candidates_identity_idx on candidates (product_id, identity_key);
create index if not exists candidates_run_idx on candidates (run_id);

-- only qualified leads land here
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  run_id        uuid not null references research_runs(id) on delete cascade,
  identity_key  text not null,
  full_name     text not null,
  email         text,
  phone         text,
  profile_url   text,
  company       text,
  signal        text not null,
  relevance     numeric not null,         -- 0..1 against the profile's criteria.
                                          -- >= 0.60 for profile runs; a control-arm run records
                                          -- the measured score even when its own gate let it through.
  criteria_met  jsonb not null,           -- which scoring_criteria passed, for auditability
  evidence      jsonb not null default '{}'::jsonb,
  outcome       text not null default 'not_contacted',
  created_at    timestamptz not null default now(),
  unique (product_id, identity_key)
);
create index if not exists leads_run_idx on leads (run_id);

create table if not exists exclusions (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  identity_key  text not null,
  reason        text,
  unique (product_id, identity_key)
);

create table if not exists skills (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid references products(id) on delete cascade,  -- null = global
  slug           text not null,
  name           text not null,
  kinds          text[] not null default '{}',  -- any of: research, outreach
  instructions   text not null,
  tool_allowlist text[] not null default '{}',
  created_at     timestamptz not null default now()
);
create unique index if not exists skills_global_slug_idx on skills (slug) where product_id is null;
create unique index if not exists skills_product_slug_idx on skills (product_id, slug) where product_id is not null;

-- which shipped default skills have already been planted. Seeding consults this
-- rather than the skills table itself, so a default the user edited is never
-- overwritten and one they deleted never comes back, while a newly shipped
-- default still lands on an existing database.
create table if not exists seeded_skills (
  slug      text primary key,
  seeded_at timestamptz not null default now()
);

create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references leads(id) on delete cascade,
  thread_id        uuid not null default gen_random_uuid(),   -- langgraph checkpoint thread
  subject          text not null,
  body             text not null,
  angle            jsonb not null,        -- { type, reason, benefit }
  critique         jsonb,
  status           text not null default 'draft',  -- draft | approved | sent | failed
  gmail_message_id text,
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists messages_lead_idx on messages (lead_id);

create table if not exists gmail_accounts (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  email             text not null,
  refresh_token_enc bytea not null,
  scope             text not null,
  connected_at      timestamptz not null default now(),
  unique (product_id, email)
);

-- the streaming spine
create table if not exists run_events (
  id         bigserial primary key,
  run_id     uuid not null,
  seq        int not null,
  kind       text not null,               -- node_start | node_end | candidate | lead | progress | done | error
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists run_events_run_seq_idx on run_events (run_id, seq);

create table if not exists billing_events (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  run_id     uuid,
  kind       text not null,               -- lead_found | profile_generated
  quantity   int not null default 1,
  created_at timestamptz not null default now()
);

-- token/tool spend per run, for the cost cap in section 12
create table if not exists run_usage (
  run_id        uuid primary key,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  model_calls   int not null default 0,
  tool_calls    int not null default 0,
  updated_at    timestamptz not null default now()
);

-- dev fallback for object storage when no S3-compatible credentials are configured.
-- production uses Neon object storage and these rows are never written.
create table if not exists storage_objects (
  object_key   text primary key,
  bucket       text not null,
  mime_type    text,
  size_bytes   bigint,
  body         bytea not null,
  created_at   timestamptz not null default now()
);

-- Tool names were collapsed from nine fine-grained verbs to four capabilities,
-- with the action passed as a parameter. Fold any saved allowlist forward.
-- Idempotent: rows already using the new names are left alone.
update skills
set tool_allowlist = (
  select coalesce(array_agg(distinct mapped), '{}')
  from unnest(tool_allowlist) as old(name)
  cross join lateral (
    select case
      when old.name like 'exa.%'        then 'exoSearch'
      when old.name like 'firecrawl.%'  then 'firecrawlSearch'
      when old.name like 'linkedin.%'   then 'linkedinSearch'
      when old.name = 'enrichment.lookup' then 'contactLookup'
      else old.name
    end
  ) as m(mapped)
)
where exists (
  select 1 from unnest(tool_allowlist) as t(name)
  where t.name like '%.%'
);

-- A skill used to be either research or outreach. It can now be marked for both,
-- so the single `kind` column became a `kinds` array. Idempotent: once the old
-- column is gone this block does nothing.
alter table skills add column if not exists kinds text[] not null default '{}';
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'skills' and column_name = 'kind'
  ) then
    execute $sql$update skills set kinds = array[kind] where cardinality(kinds) = 0 and kind is not null$sql$;
    execute $sql$alter table skills drop column kind$sql$;
  end if;
end $$;

-- A run is worked through four phases: research, lead review, communication
-- generation, outreach. The phase the user last had open is recorded here, so
-- reopening a run lands on the screen they left rather than at the beginning.
--
-- Backfilled exactly once, guarded on the column not existing rather than on
-- the value: a run the user deliberately navigated back from must not be
-- dragged forward again by the next deploy.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'research_runs' and column_name = 'phase'
  ) then
    alter table research_runs add column phase text;

    -- Drafts existing means generation is behind it, so the run belongs on
    -- outreach; leads without drafts means it stopped at the review.
    update research_runs r set phase = case
      when exists (
        select 1 from messages m join leads l on l.id = m.lead_id where l.run_id = r.id
      ) then 'outreach'
      when exists (select 1 from leads l where l.run_id = r.id) then 'lead_review'
      else 'research'
    end;

    alter table research_runs alter column phase set default 'research';
    update research_runs set phase = 'research' where phase is null;
    alter table research_runs alter column phase set not null;
  end if;
end $$;
