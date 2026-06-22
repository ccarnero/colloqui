# ADR — http-channel-instances

## Status

Accepted — 2026-06-27

## Context

HTTP channel **instances** are addressable via per-instance ingress URLs
(`/api/webhooks/http/<tenant>/<instance>`), where `instance` is the account
`externalId`. The transport, account resolution, SDK, and trigger `accountIds`
pin are already implemented and deployed (Option B). Three gaps remained:

1. The NATS consumer must forward `instance` to account resolution; if dropped,
   routing silently degrades to token-only and instance isolation is lost.
2. The sample `setup.sh` defaulted `FANOUT_PIN=0` because the per-instance
   redeploy had not yet happened.
3. The Admin Console rendered `<app-secret>` as a literal placeholder in the
   per-account curl snippet, forcing users to hunt for the token.

Two of these required real decisions: how to surface the token (Gap 3) and
whether to flip the pin default (Gap 2). Gap 1 turned out to already be correct
in code and only needs a regression guard.

## Decision

### (a) Token surface for Gap 3 — use the value already on the account

The channel-service `list`/`get` endpoints already return `appSecret` unredacted
via `mapRow`, and the Admin Console `IChannelAccount` model already declares
`appSecret?`. We render `account.appSecret` directly in `ingestCurlFor`, with a
`?? "<app-secret>"` fallback for accounts without a secret.

We rejected adding a creation-only reveal modal (token is needed for every
existing account, not just at creation) and a dedicated token endpoint (the data
is already in hand; a new endpoint and round-trip add cost for no gain). This is
a one-line change with no new surface area.

### (b) FANOUT_PIN defaults to 1

The per-instance URL redeploy is complete. With distinct URLs, every message to
an instance resolves to exactly that account, so pinning the trigger via
`accountIds` matches reliably and prevents cross-firing between HTTP workflows.
Pinning is the safer, more correct default for a multi-workflow tenant. We keep
`FANOUT_PIN=0` as an explicit opt-out for the single-HTTP-workflow case where any
HTTP message should fire the workflow.

## Consequences

**Positive**
- Copy-paste curl from the console works immediately for existing accounts.
- The sample is correct out of the box post-redeploy; no manual flag flip.
- A regression test locks the consumer's `instance` forwarding invariant.
- Zero schema, migration, or API-contract changes.

**Negative / risks**
- The console now visibly displays `appSecret` in plaintext to any authenticated
  user. Exposure is not widened (already on the wire) but is more prominent. If
  secret redaction becomes a requirement, the correct follow-up is a scoped
  `reveal token` endpoint applied uniformly across channels — tracked separately,
  not coupled here.
- Flipping `FANOUT_PIN` default changes sample behavior for users who relied on
  the implicit `0`; mitigated by keeping the explicit override and updating the
  inline comment.

## Alternatives rejected

- **Gap 3 (b)** copy-token-only-on-create modal — does not serve existing
  accounts; adds modal state.
- **Gap 3 (c)** dedicated GET token endpoint — redundant; list already returns
  the secret. Reserved as the path forward only if redaction is later required.
