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
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracked_events_correlation_id
  ON tracking.tracked_events (correlation_id);

CREATE INDEX IF NOT EXISTS idx_tracked_events_occurred_at
  ON tracking.tracked_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_tracked_events_business_fn
  ON tracking.tracked_events (business_fn);
