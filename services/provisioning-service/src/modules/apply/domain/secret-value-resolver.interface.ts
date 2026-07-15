// Port writers use to resolve a `secretRef` through the T05 secrets broker
// (SPEC.md: "T04 writers that failed with `secret_not_resolvable` can now
// resolve bindings via the broker where the flow needs it"). Kept minimal —
// only `channels-writer.ts` and `connectors-writer.ts` are wired to it
// (hosted-service k8s-native env delivery, decision 7, is explicitly a
// later concern per SPEC.md T05 scope note).

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

export interface SecretValueResolverArgs {
  readonly tenantId: string;
  readonly kind: ResourceKind;
  readonly owner: string;
  readonly secretName: string;
  readonly correlationId?: string;
}

export type SecretValueResolverResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

export interface ISecretValueResolver {
  resolve(args: SecretValueResolverArgs): Promise<SecretValueResolverResult>;
}
