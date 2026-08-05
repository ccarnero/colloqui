# DESIGN — Workflow run view (visual contract)

Class: RECORD
Summary: The binding visual contract agreed on 2026-07-11 for the workflow run view, paired with its DESIGN-run-view.html mockup; the feature it specifies has shipped.
Status: historical

> Agreed with the user on 2026-07-11 (Cowork session) through iterative mockups.
> This document + the mockup file `DESIGN-run-view.html` are the BINDING visual
> contract for `manual-loops/run-view.md`. Reviewers judge the implementation
> against this. Engram topic: `tracking/run-view-design`.

## What this view is

An **instance view** of one workflow run (`workflow_id` + `run_id`) — "how did
this run execute its definition", Temporal-UI-like but in platform vocabulary:
connectors, agents, channel accounts as first-class actors with names.

It complements (does not replace) the correlation views:
- Causal graph / waterfall (trace console) = "what happened around this message".
- Run view = "how did this workflow run execute, step by step".

## Layout (top to bottom)

1. **Header chips**: workflow name + definition version, run_id, status
   (`completed · 5/5 · 3 not executed`), duration, correlation_id (links to trace).
2. **Cast strip** ("involucrados"): one chip per distinct artifact instance
   (connector, tool, agent, channel account) with type and usage count.
   Click = highlight that artifact's steps in the flow.
3. **Vertical flow** (equally-spaced steps, NOT time-scaled — time lives in labels):
   - Left column = the run spine: trigger, run started, numbered steps, completed.
   - Right column = artifacts, ONLY in linear segments (full req/resp arrows
     with sizes and ms; solid = request, dashed = response).
   - In branched segments the artifact collapses to an `↔ name · ms · status`
     chip inside the step box.
4. **Popup on step click** (anchored to the clicked step, side depends on
   position, never scrolls the page):
   - Step detail: identity, rows (ids, operation, events pair), request/response
     (lock icon — payload requires admin role, from payload-capture),
     action buttons.
   - Buttons navigate INSIDE the popup to peek sub-views (connector profile,
     recent calls, agent profile, recent runs, channel account, workflow
     definition) with a back arrow, PLUS a deep-link "Open in <feature>" that
     routes to the real console page (Connectors / Agents / Channels / Builder)
     — e.g. connector cache config and hit-rate live in Connectors, the popup
     only quotes a summary.

## Flow semantics (all patterns)

| Element | Rendering |
|---|---|
| Step executed ok | solid box, `n · type → instance-name`, ms + ok |
| Artifact round-trip (linear) | solid arrow out (req size), dashed arrow back (status · size · ms) |
| Condition (if / else-if / else) | AMBER box, subtitle `evaluó: <value> → caso "X" ✓`; taken edge solid+thicker, others dashed |
| Branch defined but not executed | dashed box + dashed edge, label `no ejecutada` |
| If without else, false | amber box `evaluó: false → salteado`, thick bypass edge to next step |
| Nested if | same rules, one indentation level (`└`) |
| Parallel fork | `fork ∥` pill, lanes side by side (max 2-3, then collapse to summary), each lane its own steps |
| Join | `join` pill + `esperó a <rama> · t+<ms>`; the slowest branch's edge is THICKER and labeled `ruta crítica · <ms>` |
| Agent step | purple, sub-events collapsed (`tool_call ×n · memory ×n`), expandable |
| Channel steps | teal (trigger and sends) |
| Point events | no duration bar; pairing via `tracked_event_spans` |

Colors: gray = platform/structural, amber = decisions, purple = agent, teal =
channel. Instance names inline ALWAYS (`http_call → order-api`); everything else
in the popup.

## Data sources

| Element | Source |
|---|---|
| Spine steps + condition evaluations | `tracked_events` filtered by `workflow_id`/`run_id` — REQUIRES `manual-loops/workflow-step-events.md` (events do not exist yet) |
| Durations | `tracking.tracked_event_spans` (`duration_ms`) |
| Planned-vs-executed (dashed steps, case labels) | workflow definition `actions` (workflow-service, by version) |
| Instance names | `connector_id` column, `transport.agent_id`, channel account from envelope |
| Cast strip | aggregation over the same fields |
| Payloads in popup | payload endpoint (`manual-loops/payload-capture.md`, admin + audit) |
| Peek sub-views | existing console services (connectors, agents, channels) — quoted, not duplicated |

## Entries

- Workflows → detail → Executions → click a run.
- Trace detail (`processes/trace/:correlationId`) → "Run view" tab appears when
  the chain contains a workflow run (decision 2026-07-11: BOTH entries).

## Mockup file

`DOCS/archive/DESIGN-run-view.html` — self-contained interactive mockup (open in a
browser). Note: it uses CSS variables from the design environment; visual tone
in the console should follow the console's own theme, keeping the STRUCTURE
(layout, semantics, popup behavior) of this contract.
