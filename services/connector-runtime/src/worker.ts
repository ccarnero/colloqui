import "./instrumentation";
import dns from "dns";
import { CONNECTOR_RUNTIME_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import * as activities from "./activities";
import { httpAdapterConfig } from "./config";

const logger = new PinoLoggerService("connector-runtime");

dns.setDefaultResultOrder("ipv4first");

const legacyRaw =
  process.env.LEGACY_CONNECTOR_RUNTIME_TASK_QUEUE ??
  process.env.LEGACY_TASK_QUEUE;
const legacy = legacyRaw?.trim() ?? "";

runTemporalWorkerCli(
  {
    port: httpAdapterConfig.port,
    temporalAddress: httpAdapterConfig.temporalAddress,
    logger,
    startupMessage: `connector-runtime started on task queue "${CONNECTOR_RUNTIME_TASK_QUEUE}"`,
    shutdownMessage: "Shutting down connector-runtime...",
    exitOnSignal: true,
    legacyTaskQueue: legacy.length > 0 ? legacy : undefined,
    workerOptions: {
      namespace: httpAdapterConfig.temporalNamespace,
      taskQueue: CONNECTOR_RUNTIME_TASK_QUEUE,
      activities,
      maxConcurrentActivityTaskExecutions: 200,
      shutdownGraceTime: "30s",
    },
  },
  "connector-runtime worker failed",
);
