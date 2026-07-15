// Types for the T05 secrets broker (SPEC.md decision 5: the broker lives
// INSIDE provisioning-service — single RBAC-privileged reader; consumers
// present service identity + the resource they act for; the broker
// enforces the scope binding, delivers ephemerally, emits audit events).
//
// Resolution mechanics (a necessary implementation detail SPEC.md's brief
// description left implicit, NOT a reinterpretation of the secrets model):
// SPEC.md's `PUT /secrets/:name` writes ONE key (`name`) inside the
// per-resource k8s Secret `psec-<kind>-<owner>` — the binding therefore
// lives on the KEY, not just the Secret object. A caller presenting a
// mismatched `actingResource` computes a DIFFERENT k8s Secret name (its own
// resource's), where the requested `secretName` key will not exist — this
// is the concrete "binding does not match" failure mode the broker denies
// and audits.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

export interface ActingResource {
  readonly kind: ResourceKind;
  readonly owner: string;
}

export interface ResolveSecretRequest {
  readonly tenantId: string;
  /** Caller's own service identity (SPEC.md: "caller presents service identity"). */
  readonly consumerService: string;
  /** Which named secret binding to resolve (the manifest's `secretRef` value). */
  readonly secretName: string;
  readonly actingResource: ActingResource;
  readonly correlationId: string;
}

export type ResolveSecretErrorKind =
  | "not_found"
  | "binding_mismatch"
  | "consumer_unauthorized"
  | "downstream_error";

export interface ResolveSecretError {
  readonly kind: ResolveSecretErrorKind;
  /** Never includes the secret value. */
  readonly message: string;
}

export interface ResolvedSecretValue {
  /** Ephemeral — callers MUST NOT log, cache, or persist this. */
  readonly value: string;
}

export type ResolveSecretResult =
  | { readonly ok: true; readonly value: ResolvedSecretValue }
  | { readonly ok: false; readonly error: ResolveSecretError };

export interface ISecretsBroker {
  resolve(request: ResolveSecretRequest): Promise<ResolveSecretResult>;
}

export const SECRETS_BROKER = Symbol("SECRETS_BROKER");
