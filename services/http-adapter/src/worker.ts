import "./instrumentation";
import dns from "dns";
import { HTTP_ADAPTER_TASK_QUEUE } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { runTemporalWorkerCli } from "./temporal-worker-bootstrap";
import * as activities from "./activities";
import { httpAdapterConfig } from "./config";

const logger = new PinoLoggerService("http-adapter");

dns.setDefaultResultOrder("ipv4first");

runTemporalWorkerCli(
  {
    port: httpAdapterConfig.port,
    temporalAddress: httpAdapterConfig.temporalAddress,
    logger,
    startupMessage: `HTTP adapter started on task queue "${HTTP_ADAPTER_TASK_QUEUE}"`,
    shutdownMessage: "Shutting down HTTP adapter...",
    exitOnSignal: true,
    workerOptions: {
      namespace: httpAdapterConfig.temporalNamespace,
      taskQueue: HTTP_ADAPTER_TASK_QUEUE,
      activities,
      maxConcurrentActivityTaskExecutions: 200,
      shutdownGraceTime: "30s",
    },
  },
  "HTTP worker failed",
);
