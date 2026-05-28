import "../instrumentation";
import { WORKFLOW_ORCHESTRATOR_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
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
      // Stress-grade concurrency. Execution slots cap actual parallel work;
      // poller autoscaling only adjusts task pickup pressure. Bounds stay well
      // below Temporal's autoscaling default maximum of 100 so burst pickup does
      // not blindly amplify persistence pressure.
      maxConcurrentActivityTaskExecutions: 200,
      maxConcurrentWorkflowTaskExecutions: 150,
      activityTaskPollerBehavior: {
        type: "autoscaling",
        minimum: 1,
        initial: 5,
        maximum: 40,
      },
      workflowTaskPollerBehavior: {
        type: "autoscaling",
        minimum: 1,
        initial: 5,
        maximum: 20,
      },
      shutdownGraceTime: "30s",
    },
  },
  "Orchestrator worker failed",
);
