import { createServer } from 'http';
import { Worker, NativeConnection } from '@temporalio/worker';
import { WORKFLOW_ORCHESTRATOR_TASK_QUEUE } from '@yoizen/shared';
import * as activities from './activities';

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
    taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
    maxConcurrentActivityTaskExecutions: 100,
    maxConcurrentWorkflowTaskExecutions: 50,
    shutdownGraceTime: '30s',
  });

  healthy = true;
  console.log(
    `Orchestrator worker started on task queue "${WORKFLOW_ORCHESTRATOR_TASK_QUEUE}"`,
  );

  const shutdown = async () => {
    healthy = false;
    console.log('Shutting down orchestrator worker...');
    worker.shutdown();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await worker.run();
}

main().catch((err) => {
  console.error('Orchestrator worker failed:', err);
  process.exit(1);
});
