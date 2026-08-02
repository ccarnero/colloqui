import type * as k8s from "@kubernetes/client-node";
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ensureTenantIngressStream } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  clampTenantStreamLimits,
  DEFAULT_TENANT_MESSAGING_TIER,
  invalidPlatformEnvironmentMessage,
  readMessagingCeilingsFromEnv,
  TENANT_TIER_LIMITS,
  TenantDatabaseTier,
  type TenantDatabaseTierValue,
  type TenantTier,
  tenantKubernetesNamespaceName,
} from "@yoizen/shared";
import type { JetStreamManager } from "nats";
import { tenantServiceConfig } from "../../config";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import {
  isKubernetesConflictError,
  isKubernetesNotFoundError,
} from "../../providers/kubernetes-errors";
import { JETSTREAM_MANAGER } from "../../providers/nats.module";
import {
  type ITenantProvisioner,
  TENANT_PROVISIONER,
} from "../../providers/tenant-provisioner.interface";
import {
  type Environment,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from "../tenants/tenant.dto";

const LABEL_TENANT = "yoizen.io/tenant";
const LABEL_ENVIRONMENT = "yoizen.io/environment";
const LABEL_MANAGED_BY = "yoizen.io/managed-by";
const LABEL_PART_OF = "app.kubernetes.io/part-of";
const MANAGED_BY_VALUE = "tenant-service";
const PART_OF_VALUE = "yoizen-arch";

const NAMESPACE_TERMINATING_PHASE = "Terminating";

function namespaceTerminationTimeoutMs(): number {
  return Number(process.env.TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS) || 60_000;
}

function namespaceTerminationPollMs(): number {
  return Number(process.env.TENANT_NAMESPACE_TERMINATION_POLL_MS) || 1_000;
}

interface ITenantProvisioningRunParams {
  readonly name: string;
  readonly tier?: TenantDatabaseTierValue;
  /** Messaging tier for the INGRESS stream limits; defaults to `free`. */
  readonly messagingTier?: TenantTier;
  readonly configuration: TenantConfiguration;
}

function unwrapNamespace(res: unknown): k8s.V1Namespace {
  if (res && typeof res === "object" && "body" in res) {
    return (res as { body: k8s.V1Namespace }).body;
  }
  return res as k8s.V1Namespace;
}

@Injectable()
export class TenantProvisioningExecutor {
  private readonly logger = new PinoLoggerService(
    TenantProvisioningExecutor.name
  );
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(TENANT_PROVISIONER) private readonly provisioner: ITenantProvisioner,
  ) {
    const env = tenantServiceConfig.platformEnvironment;
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new InternalServerErrorException(
        invalidPlatformEnvironmentMessage(env),
      );
    }
    this.environment = env as Environment;
  }

  /**
   * Creates or reconciles the tenant namespace, provisions tenant storage
   * (shared logical DB or dedicated StatefulSet), then ensures NATS streams.
   */
  async run(params: ITenantProvisioningRunParams): Promise<{
    nsName: string;
    namespacePhase: string;
  }> {
    const { name } = params;
    const tier = params.tier ?? TenantDatabaseTier.Shared;
    const nsName = tenantKubernetesNamespaceName(name, this.environment);
    const totalStarted = performance.now();
    const phaseTag = `tenant=${name} tier=${tier} ns=${nsName}`;

    const phase = await this.runPhase(`namespace.ensure ${phaseTag}`, () =>
      this.ensureNamespace(name, nsName)
    );

    await this.runPhase(`database.provision ${phaseTag}`, () =>
      this.provisioner.provision({
        namespace: nsName,
        tenantId: name,
        tier,
      })
    );
    await this.runPhase(`database.waitForReady ${phaseTag}`, () =>
      this.provisioner.waitForReady(nsName, tier)
    );

    // Tier-aware creation (tenant-messaging-tiers T02, decision 2): the
    // provisioning path is the ONLY tier-aware creator. Tier limits are
    // clamped by the environment ceilings so a pro/enterprise tenant in a
    // small cluster gets what the cluster can hold (decision 3).
    // INTERIM (T02→T05): until T05 ships the dev overlay's MESSAGING_*
    // ceilings, provisioning a pro/enterprise tenant in dev requests limits
    // the 2 GiB single-node account cannot grant — streams.add fails and the
    // tenant ends provisioning-failed (terminal; delete-and-recreate to
    // retry). Recorded in the SPEC's T02 Progress entry.
    const messagingTier: TenantTier =
      params.messagingTier ?? DEFAULT_TENANT_MESSAGING_TIER;
    const limits = clampTenantStreamLimits(
      TENANT_TIER_LIMITS[messagingTier],
      readMessagingCeilingsFromEnv()
    );
    await this.runPhase(
      `nats.ensure-ingress-stream ${phaseTag} messagingTier=${messagingTier}`,
      () => ensureTenantIngressStream(this.jsm, name, { limits })
    );

    const totalElapsedMs = Math.round(performance.now() - totalStarted);
    this.logger.log(
      `Background provisioning complete for tenant '${name}' in ${nsName} (tier=${tier}, total=${totalElapsedMs}ms)`
    );

    return { nsName, namespacePhase: phase };
  }

  private async ensureNamespace(name: string, nsName: string): Promise<string> {
    const body: k8s.V1Namespace = {
      metadata: {
        name: nsName,
        labels: {
          [LABEL_PART_OF]: PART_OF_VALUE,
          [LABEL_TENANT]: name,
          [LABEL_ENVIRONMENT]: this.environment,
          [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
        },
      },
    };

    try {
      const created = await this.k8sApi.createNamespace({ body });
      const ns = unwrapNamespace(created);
      return ns.status?.phase ?? "Active";
    } catch (err: unknown) {
      if (!isKubernetesConflictError(err)) {
        throw err;
      }
      return this.handleExistingNamespace(name, nsName, body);
    }
  }

  /**
   * Reconciles an existing namespace. If it's stuck in `Terminating` (e.g.
   * leftover from a previous delete), we wait until it's fully gone, then
   * recreate it. Otherwise the upcoming secret/StatefulSet writes would 403
   * with `NamespaceTerminating`.
   */
  private async handleExistingNamespace(
    name: string,
    nsName: string,
    body: k8s.V1Namespace
  ): Promise<string> {
    const read = await this.k8sApi.readNamespace({ name: nsName });
    const ns = unwrapNamespace(read);
    const phase = ns.status?.phase ?? "Active";

    if (phase !== NAMESPACE_TERMINATING_PHASE) {
      this.logger.log(
        `Namespace ${nsName} already exists (phase=${phase}), continuing provisioning`
      );
      return phase;
    }

    this.logger.log(
      `Namespace ${nsName} is Terminating; waiting for full deletion before recreating`
    );
    await this.waitForNamespaceDeleted(nsName);

    const recreated = await this.k8sApi.createNamespace({ body });
    const created = unwrapNamespace(recreated);
    this.logger.log(`Namespace ${nsName} recreated after termination`);
    return created.status?.phase ?? "Active";
  }

  private async waitForNamespaceDeleted(nsName: string): Promise<void> {
    const timeoutMs = namespaceTerminationTimeoutMs();
    const pollMs = namespaceTerminationPollMs();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await this.k8sApi.readNamespace({ name: nsName });
      } catch (err: unknown) {
        if (isKubernetesNotFoundError(err)) {
          return;
        }
        throw err;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });
    }
    throw new InternalServerErrorException(
      `Namespace ${nsName} did not finish terminating within ${timeoutMs}ms`
    );
  }

  private async runPhase<T>(
    phaseLabel: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    this.logger.log(`phase=${phaseLabel} status=started`);
    try {
      const result = await fn();
      const elapsedMs = Math.round(performance.now() - started);
      this.logger.log(`phase=${phaseLabel} status=ok elapsedMs=${elapsedMs}`);
      return result;
    } catch (err: unknown) {
      const elapsedMs = Math.round(performance.now() - started);
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `phase=${phaseLabel} status=failed elapsedMs=${elapsedMs} error=${detail}`
      );
      throw err;
    }
  }
}
