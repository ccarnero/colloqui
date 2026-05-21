import "./instrumentation";
import dns from "dns";
import { CONNECTOR_RUNTIME_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import * as activities from "./activities";
import { workflowHttpWorkerConfig } from "./config";

const logger = new PinoLoggerService("connector-runtime");

dns.setDefaultResultOrder("ipv4first");

runTemporalWorkerCli(
  {
    port: workflowHttpWorkerConfig.port,
    temporalAddress: workflowHttpWorkerConfig.temporalAddress,
    logger,
    startupMessage: `HTTP worker started on task queue "${CONNECTOR_RUNTIME_TASK_QUEUE}"`,
    shutdownMessage: "Shutting down connector-runtime...",
    exitOnSignal: true,
    workerOptions: {
      namespace: workflowHttpWorkerConfig.temporalNamespace,
      taskQueue: CONNECTOR_RUNTIME_TASK_QUEUE,
      activities,
      // Stress-grade concurrency. HTTP activities are pure I/O
      // (outbound `tracedFetch`) so a single pod can comfortably
      // sustain hundreds of in-flight requests. 400 doubles the
      // per-pod ceiling; KEDA picks up the slack horizontally.
      maxConcurrentActivityTaskExecutions: 400,
      maxConcurrentActivityTaskPolls: 20,
      shutdownGraceTime: "30s",
    },
  },
  "Connector runtime failed",
);
