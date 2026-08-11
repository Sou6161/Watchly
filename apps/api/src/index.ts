import { createServer } from 'node:http';
import { env } from './env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { initRealtime } from './realtime.js';
import { startAbandonmentSweep } from './jobs/abandon-stale.js';

const app = createApp();

const httpServer = createServer(app);
const io = initRealtime(httpServer);
const stopSweep = startAbandonmentSweep();

httpServer.listen(env.PORT, () => {
  console.log(`Watchly API listening on :${env.PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return; // A second SIGTERM shouldn't restart the teardown.
  shuttingDown = true;
  console.log(`${signal} received — shutting down.`);

  stopSweep();
  io.close();

  httpServer.close(async () => {
    await prisma.$disconnect();
    console.log('Closed cleanly.');
    process.exit(0);
  });

  setTimeout(async () => {
    console.warn('Shutdown timed out; forcing exit.');
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
