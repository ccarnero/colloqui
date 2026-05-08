import "../instrumentation";
import { PinoLoggerService } from "@yoizen/observability";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import { workflowServiceConfig } from "../config";
import * as activities from "./activities";
import { WORKFLOW_ORCHESTRATOR_TASK_QUEUE } from "./workflow-queue";

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
      maxConcurrentActivityTaskExecutions: 100,
      maxConcurrentWorkflowTaskExecutions: 50,
      shutdownGraceTime: "30s",
    },
  },
  "Orchestrator worker failed",
);
