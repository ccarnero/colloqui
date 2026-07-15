// `ISecretValueResolver` adapter over the T05 `SecretsBrokerService` — the
// apply engine's consumer identity is a fixed, non-secret literal
// (`"provisioning-service-apply-engine"`), never a real user identity, so
// the broker's audit trail can distinguish apply-triggered resolves from
// any future external caller. The resolved value NEVER passes through a
// log call in this file.

import { Injectable } from "@nestjs/common";
import { SecretsBrokerService } from "../../secrets/broker/secrets-broker.service";
// Single source of truth for the apply engine's consumer identity — the
// broker's consumer-authorization policy (`secret-consumer-policy.ts`)
// allow-lists this exact literal for every resource kind.
import { APPLY_ENGINE_CONSUMER_SERVICE } from "../../secrets/lib/secret-consumer-policy";
import type {
  ISecretValueResolver,
  SecretValueResolverArgs,
  SecretValueResolverResult,
} from "../domain/secret-value-resolver.interface";

export { APPLY_ENGINE_CONSUMER_SERVICE };

@Injectable()
export class BrokerSecretResolver implements ISecretValueResolver {
  constructor(private readonly broker: SecretsBrokerService) {}

  async resolve(
    args: SecretValueResolverArgs
  ): Promise<SecretValueResolverResult> {
    const result = await this.broker.resolve({
      tenantId: args.tenantId,
      consumerService: APPLY_ENGINE_CONSUMER_SERVICE,
      secretName: args.secretName,
      actingResource: { kind: args.kind, owner: args.owner },
      // The apply run's correlationId, or a per-call fallback so the
      // broker's audit trail always has a non-empty correlation to chain
      // off (still never a value).
      correlationId:
        args.correlationId ?? `${args.kind}:${args.owner}:${args.secretName}`,
    });
    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, value: result.value.value };
  }
}
