import "./instrumentation";
import dns from "dns";
import { WORKFLOW_HTTP_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import * as activities from "./activities";
import { workflowHttpWorkerConfig } from "./config";

const logger = new PinoLoggerService("workflow-http-worker");

dns.setDefaultResultOrder("ipv4first");

runTemporalWorkerCli(
  {
    port: workflowHttpWorkerConfig.port,
    temporalAddress: workflowHttpWorkerConfig.temporalAddress,
    logger,
    startupMessage: `HTTP worker started on task queue "${WORKFLOW_HTTP_TASK_QUEUE}"`,
    shutdownMessage: "Shutting down HTTP worker...",
    exitOnSignal: true,
    workerOptions: {
      namespace: workflowHttpWorkerConfig.temporalNamespace,
      taskQueue: WORKFLOW_HTTP_TASK_QUEUE,
      activities,
      maxConcurrentActivityTaskExecutions: 200,
      shutdownGraceTime: "30s",
    },
  },
  "HTTP worker failed",
);
