// Port for the T05 secrets audit trail (TAXONOMY.md rule 23, human-approved
// 2026-07-14). Same subject family / producer / domain / channel / provider
// as T04's rule 22 (`evt.<tenant>.provisioning-service.provisioning.
// platform.internal.<kind>.v1`), a NEW `business_fn: secrets-audit` (kept
// SEPARATE from T04's `provisioning` value per the human decision), and its
// own three kinds: `secret_written`, `secret_resolved`, `secret_access_denied`.
//
// Every method is BEST-EFFORT and must NEVER throw (same contract as
// `IApplyEventPublisher`) — a broker/audit outage must never block a write
// or a resolve. Payloads NEVER carry a secret VALUE — only name/kind/owner/
// consumer/correlation metadata.
//
// CAUSAL DESIGN (documented here because it is the emitter's actual
// behavior, per SPEC.md's "document the choice consistent with what the
// emitter does"):
// - `secret_written` is its OWN root: `PUT /secrets/:name` is an
//   operator/admin action, not a step inside an existing apply-run chain,
//   so it gets a fresh generated id used as BOTH its own envelope id and
//   its `correlation_id`, with `causation_id: null`, depth 0 — same
//   standalone-root shape as `apply_started`.
// - `secret_resolved` / `secret_access_denied` are SIBLING hops off the
//   caller-supplied `correlationId` (the resolve request's `correlationId`,
//   e.g. the apply run that needs the secret): `causation_id` is set to
//   that SAME `correlationId` (mirroring this codebase's convention that a
//   chain root's own envelope id equals its `correlation_id` — see
//   `apply-events.publisher.ts`), and depth is 1, exactly like
//   `resource_applied`'s sibling hop off `apply_started`.

export interface SecretWrittenEvent {
  readonly tenantId: string;
  readonly secretName: string;
  readonly kind: string;
  readonly owner: string;
}

export interface SecretResolvedEvent {
  readonly tenantId: string;
  readonly secretName: string;
  readonly kind: string;
  readonly owner: string;
  readonly consumerService: string;
  readonly correlationId: string;
}

export interface SecretAccessDeniedEvent {
  readonly tenantId: string;
  readonly secretName: string;
  readonly kind: string;
  readonly owner: string;
  readonly consumerService: string;
  readonly correlationId: string;
  readonly reason: string;
}

export interface ISecretAuditPublisher {
  secretWritten(event: SecretWrittenEvent): Promise<void>;
  secretResolved(event: SecretResolvedEvent): Promise<void>;
  secretAccessDenied(event: SecretAccessDeniedEvent): Promise<void>;
}

export const SECRET_AUDIT_PUBLISHER = Symbol("SECRET_AUDIT_PUBLISHER");

/** No-op publisher for tests / contexts where audit events are irrelevant. */
export const NOOP_SECRET_AUDIT_PUBLISHER: ISecretAuditPublisher = {
  async secretWritten() {},
  async secretResolved() {},
  async secretAccessDenied() {},
};
