import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import path from 'node:path';
import { PythonBridge } from './pythonBridge';
import { SynthesizeRequest } from './schemas';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_DIR = path.resolve(import.meta.dir, '../public');

const fastify = Fastify({ logger: true });

const bridge = new PythonBridge();

await fastify.register(staticPlugin, {
  prefix: '/',
  root: PUBLIC_DIR,
});

fastify.get('/health', async () => ({ ok: true }));

fastify.post('/synthesize', async (request, reply) => {
  const parsed = SynthesizeRequest.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.message });
  }

  try {
    const wav = await bridge.synthesize(parsed.data);
    reply.header('content-type', 'audio/wav');
    reply.header('content-length', String(wav.byteLength));
    return reply.send(Buffer.from(wav));
  } catch (err) {
    request.log.error({ err }, 'synthesize failed');
    return reply.code(500).send({ error: (err as Error).message });
  }
});

const shutdown = async (signal: string): Promise<void> => {
  fastify.log.info({ signal }, 'shutting down');
  await fastify.close();
  await bridge.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

fastify.log.info('booting python sidecar...');
await bridge.start();
fastify.log.info('python sidecar ready');

await fastify.listen({ port: PORT, host: HOST });
