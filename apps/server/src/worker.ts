import { buildWorkerServer } from './export/worker-server.js';

const port = Number.parseInt(process.env.WORKER_PORT ?? '3002', 10);
const host = process.env.WORKER_HOST ?? '0.0.0.0';

const app = await buildWorkerServer();

try {
  await app.listen({ port, host });
  app.log.info(`Export worker listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received; closing export worker`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
