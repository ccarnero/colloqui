import { Inject, Injectable } from "@nestjs/common";
import * as k8s from "@kubernetes/client-node";
import { SCHEDULER_K8S_DEFAULT_TIMEOUT_S } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { schedulerServiceConfig } from "../config";
import { K8S_BATCH_API, K8S_CORE_API } from "../providers/k8s-api.tokens";
import type { IScheduleExecutor } from "./executor.interface";
import type { ISchedule } from "../modules/schedules/schedules.service";
import type { IExecutionResult } from "../engine/engine.service";

import type { ExecutionStatus } from "../types";

const JOB_POLL_INTERVAL_MS = 3_000;
const JOB_POLL_MAX_MS = 600_000;

@Injectable()
export class K8sJobExecutor implements IScheduleExecutor {
  private readonly logger = new PinoLoggerService(K8sJobExecutor.name);
  private readonly env = schedulerServiceConfig.platformEnvironment;

  constructor(
    @Inject(K8S_CORE_API) private readonly coreApi: k8s.CoreV1Api,
    @Inject(K8S_BATCH_API) private readonly batchApi: k8s.BatchV1Api,
  ) {}

  async execute(
    schedule: ISchedule,
    tenantId: string,
  ): Promise<IExecutionResult> {
    const namespace = `${tenantId}-${this.env}-ns`;
    const jobName = `sched-${schedule.id.slice(0, 8)}-${Date.now()}`;
    const config = schedule.config;
    const timeoutSeconds =
      (config.timeout as number) || SCHEDULER_K8S_DEFAULT_TIMEOUT_S;
    const isDockerMode = schedule.exec_mode === "docker";

    let configMapName: string | undefined;

    try {
      if (!isDockerMode) {
        configMapName = `${jobName}-script`;
        await this.createScriptConfigMap(
          namespace,
          configMapName,
          config.script as string,
        );
      }

      const job = this.buildJobSpec({
        namespace,
        jobName,
        schedule,
        configMapName,
        timeoutSeconds,
      });

      await this.batchApi.createNamespacedJob({ namespace, body: job });
      this.logger.log(
        `Created K8s Job '${jobName}' in namespace '${namespace}'`,
      );

      const status = await this.waitForJobCompletion(namespace, jobName);
      const logs = await this.fetchPodLogs(namespace, jobName);

      return {
        status,
        output: logs,
        error: status === "failed" ? "Job failed" : "",
        metadata: {
          tenantId,
          namespace,
          jobName,
          execMode: schedule.exec_mode,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`K8s Job execution failed for ${jobName}: ${message}`);
      return {
        status: "failed",
        output: "",
        error: message,
        metadata: {
          tenantId,
          namespace,
          jobName,
          execMode: schedule.exec_mode,
        },
      };
    } finally {
      await this.cleanup(namespace, jobName, configMapName);
    }
  }

  private async createScriptConfigMap(
    namespace: string,
    name: string,
    script: string,
  ): Promise<void> {
    const cm: k8s.V1ConfigMap = {
      metadata: { name, namespace },
      data: { "script.js": script },
    };
    await this.coreApi.createNamespacedConfigMap({ namespace, body: cm });
  }

  private buildContainerSpec(
    schedule: ISchedule,
    configMapName: string | undefined,
  ): k8s.V1Container {
    const config = schedule.config;
    const isDockerMode = schedule.exec_mode === "docker";

    const envVars: k8s.V1EnvVar[] = Object.entries(
      (config.env as Record<string, string>) ?? {},
    ).map(([name, value]) => ({ name, value }));

    const resources = config.resources as
      | { cpu?: string; memory?: string }
      | undefined;

    const container: k8s.V1Container = {
      name: "task",
      image: isDockerMode ? (config.image as string) : "oven/bun:1.3-alpine",
      env: envVars.length > 0 ? envVars : undefined,
      resources: {
        requests: {
          cpu: resources?.cpu ?? "100m",
          memory: resources?.memory ?? "128Mi",
        },
        limits: {
          cpu: resources?.cpu ?? "500m",
          memory: resources?.memory ?? "256Mi",
        },
      },
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1001,
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      },
    };

    if (!isDockerMode && configMapName) {
      container.command = ["bun", "run", "/scripts/script.js"];
      container.volumeMounts = [
        { name: "script-volume", mountPath: "/scripts", readOnly: true },
      ];
    }

    return container;
  }

  private buildJobMetadata(
    namespace: string,
    jobName: string,
    scheduleId: string,
  ): k8s.V1ObjectMeta {
    return {
      name: jobName,
      namespace,
      labels: {
        "yoizen.io/managed-by": "scheduler-service",
        "yoizen.io/schedule-id": scheduleId,
      },
    };
  }

  private buildJobSpec(options: {
    namespace: string;
    jobName: string;
    schedule: ISchedule;
    configMapName: string | undefined;
    timeoutSeconds: number;
  }): k8s.V1Job {
    const { namespace, jobName, schedule, configMapName, timeoutSeconds } =
      options;
    const isDockerMode = schedule.exec_mode === "docker";
    const container = this.buildContainerSpec(schedule, configMapName);

    return {
      metadata: this.buildJobMetadata(namespace, jobName, schedule.id),
      spec: {
        activeDeadlineSeconds: timeoutSeconds,
        backoffLimit: 0,
        ttlSecondsAfterFinished: 300,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [container],
            volumes:
              !isDockerMode && configMapName
                ? [
                    {
                      name: "script-volume",
                      configMap: { name: configMapName },
                    },
                  ]
                : undefined,
          },
        },
      },
    };
  }

  private async waitForJobCompletion(
    namespace: string,
    jobName: string,
  ): Promise<ExecutionStatus> {
    const deadline = Date.now() + JOB_POLL_MAX_MS;

    while (Date.now() < deadline) {
      const job = await this.batchApi.readNamespacedJob({
        name: jobName,
        namespace,
      });
      const conditions = job.status?.conditions ?? [];

      for (const c of conditions) {
        if (c.type === "Complete" && c.status === "True") return "completed";
        if (c.type === "Failed" && c.status === "True") {
          if (c.reason === "DeadlineExceeded") return "timeout";
          return "failed";
        }
      }

      await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    }

    return "timeout";
  }

  private async fetchPodLogs(
    namespace: string,
    jobName: string,
  ): Promise<string> {
    try {
      const podList = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });

      const pod = podList.items[0];
      if (!pod?.metadata?.name) return "";

      const logBody = await this.coreApi.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace,
        container: "task",
        tailLines: 1000,
      });

      return typeof logBody === "string" ? logBody : String(logBody);
    } catch (err) {
      this.logger.warn(`Failed to fetch pod logs for job ${jobName}: ${err}`);
      return "";
    }
  }

  private async cleanup(
    namespace: string,
    jobName: string,
    configMapName?: string,
  ): Promise<void> {
    try {
      await this.batchApi.deleteNamespacedJob({
        name: jobName,
        namespace,
        body: { propagationPolicy: "Background" },
      });
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.debug(
        `Job delete skipped (may already be gone) ${namespace}/${jobName}: ${detail}`,
      );
    }

    if (configMapName) {
      try {
        await this.coreApi.deleteNamespacedConfigMap({
          name: configMapName,
          namespace,
        });
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        this.logger.debug(
          `ConfigMap delete skipped ${namespace}/${configMapName}: ${detail}`,
        );
      }
    }
  }
}
