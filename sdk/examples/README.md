# sdk/examples

**Reason to exist:** each folder under `sdk/examples/` demonstrates the SDK's own API
surface — auth/config, per-resource CRUD, `connectors.invoke()` sync/async, pagination,
error handling — not a platform feature and not a business story.

## Inventory

- `reference-pattern/` — the TS-SDK wrapper pattern seed (formerly `http-bridge`): a
  small Node/TypeScript app driving the platform exclusively through
  `@yoizen/platform-sdk` (`client.workflows`, `client.channels`, `client.webhooks`),
  showing the shape every SDK-surface example follows. Additional focused examples
  (auth/config, pagination, `connectors.invoke()`, error handling) are a follow-up —
  this tier currently seeds only this one sample.

## No-shared-lib rule

Samples in this tier import **only** `@yoizen/platform-sdk` — never `integrations/lib`
or any other shared sample helper. Each example must stand alone as a demonstration of
the SDK's public surface; environment resolution and any other setup logic is inlined
into the sample's own scripts rather than shared with `integrations/`.

## How this tier differs from the other two

- **`sdk/examples/`** (this tier) demonstrates the SDK's own API surface.
- **`integrations/`** documents a platform feature end to end (a channel, an AI
  capability, an HTTP/connectors flow, an MCP integration), grouped by category. See
  [`integrations/README.md`](../../integrations/README.md).
- **`demos/`** tells a business story: a believable customer scenario composing
  several integrations' worth of capability into one narrative. See
  [`demos/README.md`](../../demos/README.md).
