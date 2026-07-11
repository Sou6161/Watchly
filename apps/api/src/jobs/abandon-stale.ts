import { SESSION_IDLE_TIMEOUT_MINUTES } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { emitSessionAbandoned } from '../realtime.js';

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Closes sessions nobody has touched for 30 minutes.
 *
 * Without this, every abandoned session sits in WAITING/IN_PROGRESS forever: its
 * code stays claimed, it clutters the user's history, and a partner who wanders
 * back hours later would silently resume a session the other person has long
 * forgotten. `lastActivityAt` is bumped on every vote and on join.
 *
 * Runs in-process on a timer rather than as an external cron: unlike the nightly
 * catalog sync (which must fire on a sleeping instance), this only matters while
 * the server is up and there are live sessions to abandon.
 */
export function startAbandonmentSweep() {
  const sweep = async () => {
    try {
      const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MINUTES * 60_000);

      const stale = await prisma.session.findMany({
        where: {
          status: { in: ['WAITING', 'IN_PROGRESS'] },
          lastActivityAt: { lt: cutoff },
        },
        select: { id: true },
      });

      if (stale.length === 0) return;

      await prisma.session.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'ABANDONED' },
      });

      // Anyone still holding the session open gets told, rather than swiping into
      // a session the server has already written off.
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
