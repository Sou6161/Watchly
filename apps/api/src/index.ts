import { createServer } from 'node:http';
import { env } from './env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { initRealtime } from './realtime.js';
import { startAbandonmentSweep } from './jobs/abandon-stale.js';

const app = createApp();

// Socket.io shares the Express HTTP server rather than binding its own port —
// Render only exposes one.
const httpServer = createServer(app);
const io = initRealtime(httpServer);
const stopSweep = startAbandonmentSweep();

httpServer.listen(env.PORT, () => {
  console.log(`Watchly API listening on :${env.PORT} (${env.NODE_ENV})`);
});

/**
 * Render sends SIGTERM on every deploy and gives ~30s before SIGKILL.
 *
 * Without this, in-flight votes are cut off mid-write and Prisma's pool is never
 * released — and on Neon, connections are a metered resource, so leaking them on
 * every deploy eventually exhausts the limit.
 *
 * Sockets are closed explicitly: an open WebSocket would otherwise hold the
 * server open until the hard kill, turning a clean deploy into a 30-second stall.
 */
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

  // Don't hang forever on a stuck connection — Render will SIGKILL us anyway, and
  // exiting on our own terms at least lets Prisma disconnect.
  setTimeout(async () => {
    console.warn('Shutdown timed out; forcing exit.');
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
