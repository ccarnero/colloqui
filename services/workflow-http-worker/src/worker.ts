import './instrumentation';
import dns from 'dns';
import { createServer } from 'http';
import { Worker, NativeConnection } from '@temporalio/worker';
import { WORKFLOW_HTTP_TASK_QUEUE } from '@yoizen/shared';
import { shutdownTelemetry } from '@yoizen/observability';
import * as activities from './activities';

dns.setDefaultResultOrder('ipv4first');

let healthy = false;

function startHealthServer(port: number) {
  const server = createServer((_req, res) => {
    const status = healthy ? 200 : 503;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'starting' }));
  });
  server.listen(port, '0.0.0.0');
}

async function main() {
  const port = Number(process.env.PORT) || 3000;
  startHealthServer(port);

  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: WORKFLOW_HTTP_TASK_QUEUE,
    activities,
    maxConcurrentActivityTaskExecutions: 200,
    shutdownGraceTime: '30s',
  });

  healthy = true;
  console.log(
    `HTTP worker started on task queue "${WORKFLOW_HTTP_TASK_QUEUE}"`,
  );

  const shutdown = async () => {
    healthy = false;
    console.log('Shutting down HTTP worker...');
    worker.shutdown();
  };
  process.on('SIGINT', shutdown);

  await worker.run();
}

main().catch((err) => {
  console.error('HTTP worker failed:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
