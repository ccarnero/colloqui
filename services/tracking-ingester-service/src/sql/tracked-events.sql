-- tracked-events.sql — idempotent DDL for the message-tracking store.
--
-- Raw idempotent SQL only, per the repo pattern (no migration framework —
-- mirrors packages/database/src/postgres-provider.ts `SchemaInitializer`,
-- which runs a `string[]` of statements verbatim through `sql.unsafe`).
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS) so the schema can
-- be applied repeatedly with no error. Statements are separated by a single
-- top-level `;`; `load-schema-statements.ts` strips `--` line comments and
-- splits on `;` (no procedural bodies here, so `;`-splitting is safe).
--
-- Column set is BINDING on `TrackedEventRow`
-- (src/lib/to-tracked-event-row.ts). Nullability follows the type exactly:
--   - tenant / kind / version / correlation_id / causation_id /
--     causation_depth are nullable (non-envelope rows carry no such value).
--   - event_id is the PRIMARY KEY: canonical rows use `envelope.id`;
--     non-envelope rows (T07) synthesize `"<stream>:<seq>"`. T06 upserts with
--     `ON CONFLICT (event_id) DO NOTHING`, so the PK lives here.
--   - envelope is raw jsonb (the row type declares it `unknown`).
--   - ingested_at is DB-side (`DEFAULT now()`), never part of the mapper.

CREATE SCHEMA IF NOT EXISTS tracking;

CREATE TABLE IF NOT EXISTS tracking.tracked_events (
  event_id        text        PRIMARY KEY,
  subject         text        NOT NULL,
  tenant          text,
  producer        text        NOT NULL,
  domain          text        NOT NULL,
  kind            text,
  version         text,
  correlation_id  text,
  causation_id    text,
  causation_depth integer,
  occurred_at     timestamptz NOT NULL,
  tech            text        NOT NULL,
  business_fn     text        NOT NULL,
  rule            integer     NOT NULL,
  consumed_by     text[]      NOT NULL,
  is_claim_check  boolean     NOT NULL,
  envelope        jsonb       NOT NULL,
  compliance      text        NOT NULL DEFAULT 'full',
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

-- `compliance` was added after the table first shipped, so a bare
-- `CREATE TABLE IF NOT EXISTS` above will NOT add the column to a live table
-- that predates it. ALTER ... ADD COLUMN IF NOT EXISTS is the idempotent
-- retrofit: a no-op when the column already exists. DEFAULT 'full' is only the
-- CHEAP BULK BACKFILL that lets the NOT NULL constraint hold for pre-existing
-- rows — it is NOT the true verdict for all of them. The live table already
-- holds rows that are semantically 'none': non-envelope families (rules
-- 1/12/13/14/15 via buildNonEnvelopeRow) and rule-18 drift rows (buildDriftRow),
-- including every pre-fix stage-1 `webhook_received` event that was ingested as
-- drift before this compliance work existed. See `Compliance` in
-- src/lib/to-tracked-event-row.ts for the value set ('full'|'partial'|'none').
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS compliance text NOT NULL DEFAULT 'full';

-- CORRECTIVE, CONVERGENT backfill (pairs with the ALTER above). The DEFAULT
-- 'full' over-labels the non-envelope subset; this UPDATE fixes it using the
-- exact discriminator that separates the two body shapes:
--   - canonical ('full') and stage-1 ('partial') rows ALWAYS carry a string
--     correlation_id — guaranteed by isCompliantEnvelope (the stage-1 probe
--     preserves the field; the mapper copies it VERBATIM);
--   - buildNonEnvelopeRow / buildDriftRow ALWAYS set correlation_id NULL.
-- So `correlation_id IS NULL` is precisely the non-envelope/drift subset, and
-- flipping those from the bulk default 'full' to 'none' is historically
-- accurate. This is convergent, NOT guarded by IF NOT EXISTS: a second apply
-- matches 0 rows (they are already 'none'), so re-running the whole schema is a
-- no-op. It keys on the correlation_id predicate, never on rule numbers.
--
-- Residual imprecision (stated, not hidden): pre-fix stage-1 `webhook_received`
-- events are flipped to 'none' here. That is faithful to HOW THEY WERE INGESTED
-- — before this work they were persisted as rule-18 drift rows with a NULL
-- correlation_id, so 'none' reflects their actual stored shape, not the
-- 'partial' verdict they WOULD earn if re-ingested through the current mapper.
UPDATE tracking.tracked_events
  SET compliance = 'none'
  WHERE correlation_id IS NULL AND compliance = 'full';

-- T4 (trace-visualization) click-through detail columns — additive/nullable,
-- no backfill (historical rows simply lack these; `extract-detail-columns.ts`
-- documents field-name provenance and the known workflowId/runId gap).
-- Idempotent retrofit, same pattern as the `compliance` column above.
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS workflow_id  text;
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS run_id       text;
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS connector_id text;
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS cache_status text;

CREATE INDEX IF NOT EXISTS idx_tracked_events_correlation_id
  ON tracking.tracked_events (correlation_id);

CREATE INDEX IF NOT EXISTS idx_tracked_events_occurred_at
  ON tracking.tracked_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_tracked_events_business_fn
  ON tracking.tracked_events (business_fn);

-- T6 (trace-visualization) connector-detail dashboard filters by $connector.
CREATE INDEX IF NOT EXISTS idx_tracked_events_connector_id
  ON tracking.tracked_events (connector_id);

-- T01 (payload-capture) payload lifecycle columns — additive, idempotent
-- retrofit (same pattern as `compliance` above). `payload_status` tracks WHERE
-- the payload for a row currently lives across its life:
--   - 'inline'     — the payload is stored verbatim in `envelope.data.payload`
--                    (the default/steady-state for non-claim-check rows).
--   - 'resolved'   — T02: a claim-check ref was resolved at ingest and the
--                    full payload was persisted into `envelope`.
--   - 'unresolved' — T02: claim-check resolution FAILED (expired ref, cache
--                    down, malformed); the slim envelope was persisted as-is.
--   - 'scrubbed'   — T03: the retention scrub emptied `envelope.data.payload`
--                    after PAYLOAD_RETENTION_DAYS; `payload_scrubbed_at` records
--                    when.
--   - 'none'       — no payload ever existed for this row (non-envelope
--                    families / rows whose envelope carries no payload).
-- T01 keeps status assignment simple and status-accurate: the mapper sets
-- 'inline' when the envelope carries a non-null `data.payload`, else 'none'.
-- T02 refines this for claim-check rows ('resolved'/'unresolved') and T03
-- transitions rows to 'scrubbed' once payloads age out.
ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS payload_status text NOT NULL DEFAULT 'inline';

-- Idempotent named-constraint retrofit: DROP IF EXISTS + unconditional ADD.
-- No DO block (load-schema-statements.ts is a naive `;`-splitter with no
-- dollar-quote awareness — a DO $$ ... $$; body containing internal `;`
-- characters would be sliced into invalid fragments), so this two-statement
-- drop-then-add is the idempotent shape that stays splitter-safe.
ALTER TABLE tracking.tracked_events
  DROP CONSTRAINT IF EXISTS tracked_events_payload_status_check;
ALTER TABLE tracking.tracked_events
  ADD CONSTRAINT tracked_events_payload_status_check
  CHECK (payload_status IN ('inline', 'resolved', 'unresolved', 'scrubbed', 'none'));

-- CORRECTIVE, CONVERGENT backfill (same shape as the compliance backfill
-- above): the DEFAULT 'inline' over-labels every pre-existing row. Rows whose
-- envelope carries no payload (missing `data`/`data.payload` key, OR an
-- explicit JSON `null` — `->` returns a jsonb 'null' literal for the latter,
-- NOT a SQL NULL, hence the second disjunct) are corrected to 'none'. Scoped
-- to `payload_status = 'inline'` (the untouched bulk-default value), so a
-- second apply matches 0 rows: convergent, not guarded by IF NOT EXISTS.
UPDATE tracking.tracked_events
  SET payload_status = 'none'
  WHERE payload_status = 'inline'
    AND (
      envelope -> 'data' -> 'payload' IS NULL
      OR envelope -> 'data' -> 'payload' = 'null'::jsonb
    );

ALTER TABLE tracking.tracked_events
  ADD COLUMN IF NOT EXISTS payload_scrubbed_at timestamptz;

-- Partial index: the T03 scrub scan only ever looks for rows still carrying a
-- payload ('inline'/'resolved'), so indexing occurred_at UNDER that predicate
-- keeps the periodic scan cheap without paying for 'unresolved'/'scrubbed'/
-- 'none' rows that can never match the scrub's WHERE clause.
CREATE INDEX IF NOT EXISTS idx_tracked_events_payload_scrub_scan
  ON tracking.tracked_events (occurred_at)
  WHERE payload_status IN ('inline', 'resolved');

-- T03 (connector-trace-linking) `GET /events?type=<t>&resource=<r>&from=<iso>
-- &limit=<n>` filters on `tenant` + the CloudEvents-style `envelope->>'type'`
-- (see `build-events-query.ts` for why `type` is NOT the `domain`/`kind`/
-- `version` columns), ordered `occurred_at DESC`. A functional index on the
-- jsonb extraction keeps that filter+sort index-only instead of a per-tenant
-- sequential scan. New index, does not repurpose any existing one.
CREATE INDEX IF NOT EXISTS idx_tracked_events_tenant_type_occurred_at
  ON tracking.tracked_events (tenant, (envelope->>'type'), occurred_at DESC);

-- T05 (connection-call-inspector) `GET /events?...&resource=agent/<agentId>`
-- alias (see `build-events-query.ts`'s header note): agent-execution events
-- do not carry an `agent/<agentId>`-shaped `envelope.resource` (the emitter
-- sets `resource: "execution/<executionId>"`), so T10's "Recent executions"
-- panel filters on the payload's `agentId` field instead. No new column
-- (the SPEC's "click-through columns gain nothing unless the query plan
-- needs it" guardrail) — a functional index on the EXACT expression the
-- query filters on. Postgres only matches a functional index when the
-- predicate is syntactically identical to the indexed expression, so this
-- indexes the SAME `COALESCE(...)` tree `build-events-query.ts` emits
-- (top-level `agentId` for `execution_started`/`execution_completed`,
-- falling back to the nested `input.agentId` shape `execution_requested`
-- uses), keeping the lookup index-only instead of a per-tenant sequential
-- scan. New index, never repurposes an existing one.
CREATE INDEX IF NOT EXISTS idx_tracked_events_payload_agent_id
  ON tracking.tracked_events (
    (COALESCE(
      envelope -> 'data' -> 'payload' ->> 'agentId',
      envelope -> 'data' -> 'payload' -> 'input' ->> 'agentId'
    ))
  );
