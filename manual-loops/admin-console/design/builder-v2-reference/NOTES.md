# Builder v2 reference — extraction notes

Source: `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (1889 lines — smaller
than the ~185k figure suggested; it's a compact single-file "design canvas" component, not a
large multi-file bundle). Cross-checked against `design/11-builder.png`.

## Top-level structure of the .dc.html (for future navigation)

```
lines 1-13     <head> boilerplate, <script src="./support.js"> (the design-canvas runtime)
lines 9-1268   <x-dc> ... </x-dc>  — THE TEMPLATE. One giant markup tree using a tiny
               templating DSL: {{ expr }} interpolation, <sc-if value="{{ cond }}">,
               <sc-for list="{{ arr }}" as="item">. Structure:
                 <helmet>            — <style> block (see tokens.css), font <link>s
                 <div> app shell     — header (top bar), nav (tab row), body (sub-rail + main)
                   <main>
                     <sc-if value="{{ showDashboard }}">   ...screen 01...
                     <sc-if value="{{ showAnalytics }}">   ...screen 18-19...
                     <sc-if value="{{ showChannels }}">    ...screens 02-03...
                     <sc-if value="{{ showWorkflows }}">   ...screen 10...
                     <sc-if value="{{ showBuilder }}">     ...screen 11 — THE BUILDER...
                     <sc-if value="{{ showAgents }}">      ...screen 06...
                     <sc-if value="{{ showAgentEditor }}"> ...screens 07-09...
                     <sc-if value="{{ showTrace }}">       ...screens 12-16...
                     <sc-if value="{{ showUsers }}">       ...screen 17...
                     <sc-if value="{{ showConnDetail }}">  ...screen 05...
                     <sc-if value="{{ showChanDetail }}">  ...screen 03 detail...
                     ...etc, one <sc-if> block per screen, all siblings under <main>...
lines 1270-1887  <script> class Component extends DCLogic { ... }
                   - static data blocks: NAV (top nav sections + sub-pages), LANDING
                     (section -> default screen), BUILDER_NODES (line 1434, the builder's
                     node data — THE canonical source for node cards), CG_NODES (trace
                     causal graph), and similar per-screen static arrays further down.
                   - renderVals() (starts ~line 1457): one big method that reads
                     this.state and returns EVERY value referenced by {{ }} in the
                     template above — this is where inline style values (colors,
                     borders, glow/box-shadow) get computed per row/node/item.
line 1888      </body>
```

To find a given screen's markup: grep the `showX` flag name (e.g. `showBuilder`) in the
template half, then grep the same flag being *set* in `renderVals()` to find its condition
and any adjacent per-screen state. To find a screen's data: grep for the plural noun near the
top of `renderVals()` (e.g. `const builderNodes = ...`) or a static array on the class
(e.g. `BUILDER_NODES`).

## Builder screen location

- Markup: lines 361-493 (`<sc-if value="{{ showBuilder }}">` … node cards at 378-392,
  inspector panel at 461-491).
- Node data: `BUILDER_NODES` static array, lines 1434-1455.
- Node → visual-props mapping: `renderVals()`, lines 1548-1558 (`KIND_STRIPE`, `KIND_TINT`,
  `builderNodes` map, selection state via `bSel`).
- Dock/palette data: `dockItems`, lines 1561-1574.
- Inspector binding: `bSelName` / `bSelId` / `bSelIcon` / `bSelFields` / `bSelHint`,
  lines 1839-1844.

## Key finding: no CSS classes, no per-node-type markup

The canvas has exactly **one** `<style>` block (lines 14-46): `:root` tokens (dark +
`:root.light-theme` override), a few global base rules (`html,body`, `a`, scrollbar,
`.material-icons`), and `@keyframes dashmove`. That's it — **`.material-icons` is the only
class in the entire 1889-line file** (confirmed with `rg 'class="'`). Every node card,
button, panel, etc. is styled with inline `style="..."` attributes referencing
`var(--token)`. `style-hover="..."` / `style-focus="..."` are canvas-only pseudo-attributes
for previewing interaction states — not real CSS, don't port them as-is.

Consequently there is **no dedicated markup per node "type"** (no separate trigger-card /
branch-card / agent-card templates). There is one node-card template
(`<sc-for list="{{ builderNodes }}" as="bn">`, lines 378-392) whose visuals are entirely
data-driven by each node's `kind` field, mapped through `KIND_STRIPE` / `KIND_TINT`.

`node-card.css` and `canvas-layout.css` in this folder are therefore **not verbatim CSS
extractions** (none exist to extract) — they are mechanical transcriptions of the exact same
inline property:value pairs into class-based rules, so the values are faithful to the canvas
even though the class-based delivery mechanism and class names themselves are new (invented
here as hooks, clearly flagged in each file's header comment).

## Node variants that exist (all instances of the one template, by `kind` + `tag`)

| Node | kind | tag | icon | stripe/tint color | notes |
|---|---|---|---|---|---|
| WhatsApp Trigger | `channel` | `TRIGGER` | `bolt` | green / green-dim | inbound trigger, left edge only (no source) |
| Intent Router | `conditional` | `IF` | `alt_route` | yellow / yellow-dim | branch node — 2 outgoing edges (matched + default) |
| Qualify Lead | `agent` | `AGENT` | `smart_toy` | purple / rgba(191,122,240,.12) | shown **selected** in the PNG (accent border + glow ring + open inspector) |
| Send Reply | `channel` | `null` (no tag chip) | `send` | green / green-dim | plain outbound action |
| Fallback Message | `channel` | `null` (no tag chip) | `send` | green / green-dim | same visual variant as Send Reply — different position/summary/stats only |

Only 3 distinct visual "kinds" exist in the data (`channel`, `conditional`, `agent`); the
source code also has a fallback (`var(--line3)` stripe / `var(--hover)` tint) for any
unmapped `kind`, but no node on this screen exercises it. The dock palette (below) implies
additional node *types* users could drag in (HTTP Connector, MCP Tool, Service Call, Publish
Event, JS Function, Parallel Branch) that don't appear as instantiated cards anywhere in the
canvas — their card appearance is undefined/unspecified by this file.

## Card data fields (exact field names, from `BUILDER_NODES`)

Each node object: `id, name, tag, icon, x, y, kind, summary, stat1, stat2, ok, fields, hint`.

- **Card face** shows: icon chip, `name` (title), `tag` chip (if non-null), `summary`
  (monospace, single-line truncated), then a stats footer row of `stat1`, `stat2`, `ok`
  (status dot + text, e.g. `"● ok"`, colored `var(--green)`).
- Stats are **not standardized to "runs / p95 / ok"** — that's the trigger node's shape
  (`stat1: "1,842 runs"`, `stat2: "24h: 312"`), but other nodes use different stat1/stat2
  semantics: Intent Router uses `"2 branches"` / `"p95: 2ms"`; Qualify Lead uses
  `"1,124 runs"` / `"p95: 620ms"`; Send Reply / Fallback Message use `"N sent"` / `"p95: Xms"`.
  So the real convention is "two free-form monospace stat strings + an ok/status indicator",
  not a fixed runs/p95/ok schema — the PNG's task description ("runs/p95/ok") is only
  literally true for 2 of the 5 nodes.
- **Inspector panel** (opens on click) shows: icon, `name` (editable input), tab row
  (`Config` / `Output` / `Runs` — only `Config` has content in this mock), a `Name` field,
  then `fields[]` (each `{ label, value, select }` — `select:true` renders a chevron
  (`unfold_more` icon) suggesting a dropdown, `select:false` renders as plain read-only
  text), then a free-text `hint` paragraph, and a footer with the node `id` (monospace) and
  a `Remove` button.

## Edge / connection conventions

- Edges are raw SVG `<path>` cubic Bezier curves, not a generic edge component — coordinates
  are hardcoded per edge (no edge data array; each `<path d="...">` is written by hand for
  this exact 5-node layout).
- Two edge visual states, not formally named in the source:
  - **"live/matched" path**: `stroke:var(--accent)`, `stroke-width:1.5`,
    `stroke-dasharray:"5 5"`, animated via `@keyframes dashmove` (marching ants, 1s linear
    infinite). Used for the trigger→router edge and the "matched" branch (router→agent).
  - **"default/untaken" path**: `stroke:var(--line3)`, solid, no dash, no animation. Used
    for the router's `default` branch (router→fallback).
- Edge labels are floating `<span>` pills positioned with hardcoded `left/top` px over the
  branch point, monospace text. Two label styles: the matched-condition label uses
  `border:var(--line3)` / `color:var(--t2)` (e.g. `text contains "precio"`); the default
  label uses the dimmer `border:var(--line2)` / `color:var(--t3)` (literal text: `default`).
- Node connector "ports": small circles (10px, 2px border in the node's stripe color, bg
  `var(--bg)`) absolutely positioned at each card's vertical center, `left:-6px` /
  `right:-6px` (i.e. straddling the card edge). Every node has both a left and right port
  regardless of whether it actually has an incoming/outgoing edge (e.g. the trigger node
  still renders an unused left port).

## Palette / dock contents (bottom-center floating dock, `dockItems`)

In order, with dividers as shown:

1. Channel (`swap_horiz`, green)
2. JS Function (`code`, t2/gray)
   — divider —
3. HTTP Connector (`http`, t2/gray)
4. MCP Tool (`extension`, t2/gray)
5. Service Call (`dns`, t2/gray)
6. Publish Event (`send`, t2/gray)
   — divider —
7. Agent (`smart_toy`, purple)
   — divider —
8. Parallel Branch (`call_split`, yellow)
9. Conditional (`alt_route`, yellow)

Each dock item shows icon + short mono label (e.g. `CHAN`, `JS`, `HTTP`) stacked vertically,
`cursor:grab`, hover background `var(--hover)`.

## Fonts

- Sans: `Geist` (weights 400/500/600/700), loaded from Google Fonts, `font-family:'Geist',system-ui,sans-serif`, used as the page body default.
- Mono: `Geist Mono` (weights 400/500/600), token `--mono:'Geist Mono',ui-monospace,monospace`, used for all stat/label/badge/id text throughout the builder (stats row, tag chips, edge labels, zoom %, field labels, node id).
- Icons: Material Icons (Google Fonts icon font), `.material-icons` class, base `font-size:16px` overridden inline per usage (13-18px range observed in the builder).

## Cross-check against `design/11-builder.png`

Everything visible in the screenshot is accounted for in the HTML — this canvas is a live
render, not a static mockup with drift. Specifically confirmed present in both:
- Breadcrumb bar (`workflows / lead-qualification` + `ACTIVE` badge + `saved · 12s`)
- View segmented control (`Editor | Runs 1,842 | Settings`)
- Validity badge (`valid · 5 nodes`) + `Run test` + `Publish` buttons
- All 5 node cards, dashed/solid edges, `text contains "precio"` and `default` edge labels
- Bottom dock palette (9 icons + 2 dividers, matching `dockItems` exactly)
- Bottom-left zoom control (`− 100% + ⛶`)
- Bottom-right minimap
- Dotted background grid

No gaps found: nothing in the PNG is missing from the HTML, and nothing meaningfully
speculative in the HTML is absent from the PNG (the inspector panel is not open in this
particular screenshot crop, but its trigger condition and full markup are present in the
source and documented in node-card.html section 3 — the PNG's bottom-right does show a small
panel with a few gray placeholder bars near the "Fallback Message" card, which corresponds to
the minimap rects, not the inspector).

## Files in this folder

- `tokens.css` — `:root` design tokens (dark + light-theme), global base rules, `@keyframes dashmove`.
- `node-card.html` — raw node-card template + binding logic + 4 resolved variant instances + inspector panel markup.
- `node-card.css` — node-card + inspector styling (mechanically transcribed from inline styles, see file header).
- `canvas-layout.html` — screen root, dotted background, SVG edges/labels, top chrome, dock palette, zoom, minimap.
- `canvas-layout.css` — same content's styling (mechanically transcribed, see file header).
- `NOTES.md` — this file.
