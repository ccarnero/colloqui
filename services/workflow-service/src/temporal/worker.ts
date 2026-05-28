import "../instrumentation";
import { WORKFLOW_ORCHESTRATOR_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { OpenTelemetryActivityInboundInterceptor } from "@temporalio/interceptors-opentelemetry";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import { workflowServiceConfig } from "../config";
import * as activities from "./activities";

const logger = new PinoLoggerService("workflow-orchestrator-worker");

runTemporalWorkerCli(
  {
    port: workflowServiceConfig.port,
    temporalAddress: workflowServiceConfig.temporalAddress,
    logger,
    startupMessage: `Orchestrator worker started on task queue "${WORKFLOW_ORCHESTRATOR_TASK_QUEUE}"`,
    shutdownMessage: "Shutting down orchestrator worker...",
    exitOnSignal: false,
    workerOptions: {
      namespace: workflowServiceConfig.temporalNamespace,
      taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
      workflowsPath: require.resolve("./workflows"),
      activities,
      interceptors: {
        activity: [
          (ctx) => ({
            inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
          }),
        ],
        workflowModules: [require.resolve("./workflow-interceptors")],
      },
      // Stress-grade concurrency. The orchestrator runs both
      // workflow tasks (deterministic, CPU-bound on replay) and
      // local activities (`executeJsFunction`, `executeServiceBusCall`,
      // `executeChannelSend` — I/O bound). Bumping both ceilings
      // raises the per-pod throughput before KEDA needs to add a
      // replica. KEDA `targetQueueSize` is matched in the
      // ScaledObject so scale-out triggers when capacity is ~50%
      // utilized.
      maxConcurrentActivityTaskExecutions: 200,
      maxConcurrentWorkflowTaskExecutions: 150,
      // Default polls (5/5) cap pickup throughput on a quiet queue.
      // Bumping to 10/10 cuts schedule-to-start under burst from
      // ~200ms to <50ms with negligible CPU overhead.
      maxConcurrentActivityTaskPolls: 10,
      maxConcurrentWorkflowTaskPolls: 10,
      shutdownGraceTime: "30s",
    },
  },
  "Orchestrator worker failed",
);
