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
