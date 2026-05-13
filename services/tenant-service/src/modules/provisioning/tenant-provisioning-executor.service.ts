import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type * as k8s from "@kubernetes/client-node";
import {
  TenantDatabaseTier,
  invalidPlatformEnvironmentMessage,
  tenantKubernetesNamespaceName,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { isKubernetesConflictError } from "../../providers/kubernetes-errors";
import { TenantPostgresProvisioner } from "../../providers/postgres.provider";
import { TenantUsagePostgresProvisioner } from "../../providers/postgres-usage.provider";
import { YoizenClawRuntimeProvisioner } from "../../providers/yoizenclaw-runtime.provider";
import { tenantServiceConfig } from "../../config";
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

interface ITenantProvisioningRunParams {
  readonly name: string;
  readonly tier?: TenantDatabaseTierValue;
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
    TenantProvisioningExecutor.name,
  );
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    private readonly pgProvisioner: TenantPostgresProvisioner,
    private readonly pgUsageProvisioner: TenantUsagePostgresProvisioner,
    private readonly runtimeProvisioner: YoizenClawRuntimeProvisioner,
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
   * Creates or reconciles the tenant namespace, then provisions OLTP + usage
   * PostgreSQL according to `tier`, and finally applies the per-tenant
   * `yoizenclaw-runtime` Knative Service into the namespace:
   *
   * - **Shared**: only creates a logical database + role on the shared
   *   CloudNativePG cluster (no per-tenant Postgres StatefulSet/PVC). The
   *   namespace itself is still created because it is the per-tenant
   *   deployment scope for `registry-service` (Knative Services). An empty
   *   namespace is essentially free in K8s (one metadata object + default
   *   ServiceAccount).
   * - **Dedicated**: provisions per-tenant Postgres + TimescaleDB StatefulSets
   *   inside the namespace and blocks until both report ready.
   *
   * After Postgres is ready we apply `yoizenclaw-runtime` via
   * `YoizenClawRuntimeProvisioner.apply` (idempotent, conflict-replaces) so
   * the runtime ksvc pod can resolve `postgres-credentials` from the same
   * namespace. Set `YOIZENCLAW_RUNTIME_AUTO_APPLY=false` if a GitOps
   * controller owns it instead.
   *
   * Idempotent: namespace create conflict (409) continues with `readNamespace`.
   *
   * Each phase is wrapped in `runPhase` which logs entry/exit + duration so
   * a hang in any one step (most often `pgProvisioner.provision` for shared
   * waiting on the CNPG superuser secret, or `*.waitForReady` for dedicated
   * waiting on a StatefulSet) shows up as a "phase started but never ended"
   * gap in the structured logs instead of a silent JetStream redelivery loop.
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
      this.ensureNamespace(name, nsName),
    );

    // OLTP + usage tracks run in parallel (different K8s resources, different
    // pools); each track is wrapped individually so a hang in one branch is
    // attributable on its own — Promise.all would otherwise mask which leg
    // is stuck. `runPhase` itself rethrows, so the outer Promise.all still
    // surfaces the first failure with the full error chain preserved.
    await Promise.all([
      this.runPhase(`postgres.provision ${phaseTag}`, () =>
        this.pgProvisioner.provision({
          namespace: nsName,
          tenantId: name,
          tier,
        }),
      ),
      this.runPhase(`postgres-usage.provision ${phaseTag}`, () =>
        this.pgUsageProvisioner.provisionUsage(nsName, tier),
      ),
    ]);
    await Promise.all([
      this.runPhase(`postgres.waitForReady ${phaseTag}`, () =>
        this.pgProvisioner.waitForReady(nsName, tier),
      ),
      this.runPhase(`postgres-usage.waitForReady ${phaseTag}`, () =>
        this.pgUsageProvisioner.waitForReady(nsName, tier),
      ),
    ]);

    // The runtime Knative Service depends on the per-namespace
    // `postgres-credentials` Secret + `postgres` Service being in place; we
    // therefore apply it strictly after Postgres readiness. The provisioner
    // is idempotent (create → on 409 replace) so retries from JetStream
    // redelivery converge cleanly.
    await this.runPhase(`yoizenclaw-runtime.apply ${phaseTag}`, () =>
      this.runtimeProvisioner.apply({ namespace: nsName, tenantId: name }),
    );

    const totalElapsedMs = Math.round(performance.now() - totalStarted);
    this.logger.log(
      `Background provisioning complete for tenant '${name}' in ${nsName} (tier=${tier}, total=${totalElapsedMs}ms)`,
    );

    return { nsName, namespacePhase: phase };
  }

  /**
   * Creates the tenant namespace; returns its observed phase. On 409 Conflict
   * (already exists) re-reads the namespace so a retried provision still
   * returns a coherent phase value.
   */
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
      if (isKubernetesConflictError(err)) {
        this.logger.log(
          `Namespace ${nsName} already exists, continuing provisioning`,
        );
        const read = await this.k8sApi.readNamespace({ name: nsName });
        const ns = unwrapNamespace(read);
        return ns.status?.phase ?? "Active";
      }
      throw err;
    }
  }

  /**
   * Runs `fn` and logs `phase started` / `phase ok in Nms` markers around it.
   * Errors are rethrown after `phase failed in Nms` is emitted so the caller
   * (handler → JetStream) decides retry vs term — we only contribute an
   * audit trail with a stable `phase=...` tag for log greps / Loki alerts.
   */
  private async runPhase<T>(
    phaseLabel: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    this.logger.log(`phase=${phaseLabel} status=started`);
    try {
      const result = await fn();
      const elapsedMs = Math.round(performance.now() - started);
      this.logger.log(
        `phase=${phaseLabel} status=ok elapsedMs=${elapsedMs}`,
      );
      return result;
    } catch (err: unknown) {
      const elapsedMs = Math.round(performance.now() - started);
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `phase=${phaseLabel} status=failed elapsedMs=${elapsedMs} error=${detail}`,
      );
      throw err;
    }
  }
}
