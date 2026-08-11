import { ASYNC_SESSION_TTL_DAYS, SESSION_IDLE_TIMEOUT_MINUTES } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { emitSessionAbandoned } from '../realtime.js';

const SWEEP_INTERVAL_MS = 60_000;

export function startAbandonmentSweep() {
  const sweep = async () => {
    try {
      const liveCutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
      const asyncCutoff = new Date(Date.now() - ASYNC_SESSION_TTL_DAYS * 86_400_000);

      const stale = await prisma.session.findMany({
        where: {
          status: { in: ['WAITING', 'IN_PROGRESS'] },
          OR: [
            { isAsync: false, lastActivityAt: { lt: liveCutoff } },
            { isAsync: true, lastActivityAt: { lt: asyncCutoff } },
          ],
        },
        select: { id: true },
      });

      if (stale.length === 0) return;

      await prisma.session.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'ABANDONED' },
      });

      for (const { id } of stale) emitSessionAbandoned(id);

      console.log(`Abandoned ${stale.length} idle session(s).`);
    } catch (err) {
      // A failed sweep must not take the server down; the next one will catch up.
      console.error('Abandonment sweep failed:', err);
    }
  };

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Don't hold the process open just for the sweep timer.
  timer.unref();

  return () => clearInterval(timer);
}
