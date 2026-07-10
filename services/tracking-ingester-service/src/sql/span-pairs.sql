-- span-pairs.sql — idempotent view `tracking.tracked_event_spans`, pairing
-- `*_started`/`*_completed` rows into (span_start, span_end, duration_ms) spans
-- for OTel span emission (T1 of .sdd/changes/trace-visualization/tasks.md).
--
-- Loaded via the same mechanism as tracked-events.sql (load-schema-statements.ts
-- strips `--` comments and splits on top-level `;`). `CREATE OR REPLACE VIEW` is
-- idempotent by construction — re-applying is always a no-op change.
--
-- Pairing key: correlation_id + entity_id, where entity_id is a best-effort
-- extraction from the raw `envelope` jsonb payload of common identifier fields
-- across the families that emit started/completed pairs today (workflow
-- executions, agent executions, connector calls). New families that don't carry
-- one of these fields simply never pair and fall through as zero-duration point
-- spans below — this is a documented, safe degradation, not a hard requirement.
--
-- `kind` (parsed from the subject by to-tracked-event-row.ts) drives the pairing
-- verb: a row whose kind ends in `_started` looks for a sibling row with the
-- same correlation_id + entity_id + kind prefix, ending in `_completed`.
--
-- Rows that are NOT part of a resolvable started/completed pair (any other kind,
-- or a `_started`/`_completed` row with no matching sibling) pass through as
-- zero-duration spans (span_start = span_end = the row itself), per T1's
-- "unpaired/point events yield zero-duration spans" rule.

CREATE OR REPLACE VIEW tracking.tracked_event_spans AS
WITH base AS (
  SELECT
    event_id,
    correlation_id,
    causation_id,
    occurred_at,
    producer,
    tech,
    business_fn,
    is_claim_check,
    compliance,
    tenant,
    -- T4 click-through columns, carried through so T6's connector-detail
    -- dashboard can filter latency/cache-hit panels by connector_id.
    connector_id,
    cache_status,
    kind,
    -- Best-effort entity id: workflow execution, agent execution, or connector
    -- call identifier — whichever the envelope's `data.payload` carries.
    -- `data.payload_inline` is a BOOLEAN flag on EventEnvelope (see
    -- packages/shared/src/interfaces.ts EventData), NOT a nested object — the
    -- actual body lives at `data.payload`, so extraction reads that path only.
    COALESCE(
      envelope #>> '{data,payload,run_id}',
      envelope #>> '{data,payload,workflow_id}',
      envelope #>> '{data,payload,execution_id}',
      envelope #>> '{data,payload,executionId}',
      envelope #>> '{data,payload,call_id}'
    ) AS entity_id,
    -- kind with the started/completed verb stripped, e.g. "execution" from
    -- "execution_started" / "execution_completed" — the pairing prefix.
    regexp_replace(kind, '_(started|completed)$', '') AS kind_prefix,
    CASE
      WHEN kind ~ '_started$' THEN 'started'
      WHEN kind ~ '_completed$' THEN 'completed'
      ELSE NULL
    END AS verb
  FROM tracking.tracked_events
),
paired AS (
  SELECT
    s.event_id,
    s.correlation_id,
    s.causation_id,
    s.occurred_at AS start_time,
    e.occurred_at AS end_time,
    s.producer,
    s.tech,
    s.business_fn,
    s.is_claim_check,
    s.compliance,
    s.tenant,
    s.connector_id,
    s.cache_status
  FROM base s
  JOIN base e
    ON e.correlation_id = s.correlation_id
   AND e.entity_id IS NOT NULL
   AND e.entity_id = s.entity_id
   AND e.kind_prefix = s.kind_prefix
   AND e.verb = 'completed'
  WHERE s.verb = 'started'
    AND s.entity_id IS NOT NULL
),
unpaired AS (
  -- Every row NOT consumed as the "started" side of a resolved pair passes
  -- through as its own zero-duration span (point events, and started/completed
  -- rows that never found a sibling).
  SELECT
    b.event_id,
    b.correlation_id,
    b.causation_id,
    b.occurred_at AS start_time,
    b.occurred_at AS end_time,
    b.producer,
    b.tech,
    b.business_fn,
    b.is_claim_check,
    b.compliance,
    b.tenant,
    b.connector_id,
    b.cache_status
  FROM base b
  WHERE b.event_id NOT IN (SELECT event_id FROM paired)
    AND NOT (
      b.verb = 'completed'
      AND EXISTS (
        SELECT 1 FROM base s2
        WHERE s2.verb = 'started'
          AND s2.correlation_id = b.correlation_id
          AND s2.entity_id IS NOT NULL
          AND s2.entity_id = b.entity_id
          AND s2.kind_prefix = b.kind_prefix
      )
    )
)
SELECT
  event_id,
  correlation_id,
  causation_id,
  start_time,
  end_time,
  EXTRACT(EPOCH FROM (end_time - start_time)) * 1000 AS duration_ms,
  producer AS service_name,
  tech,
  business_fn,
  is_claim_check,
  compliance,
  tenant,
  connector_id,
  cache_status
FROM paired
UNION ALL
SELECT
  event_id,
  correlation_id,
  causation_id,
  start_time,
  end_time,
  0 AS duration_ms,
  producer AS service_name,
  tech,
  business_fn,
  is_claim_check,
  compliance,
  tenant,
  connector_id,
  cache_status
FROM unpaired;
