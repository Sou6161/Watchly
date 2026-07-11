import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionProgressPayload,
  Voter,
} from '@watchly/shared';
import { prisma } from './lib/prisma.js';
import { verifyAccessToken } from './lib/auth.js';

interface SocketData {
  userId: string;
  sessionId?: string;
  voter?: Voter;
}

type WatchlySocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

let io: Server<ClientToServerEvents, ServerToClientEvents, never, SocketData> | null = null;

/** Everyone in a session shares one room, keyed by session id. */
const room = (sessionId: string) => `session:${sessionId}`;

export function initRealtime(httpServer: HttpServer) {
  io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(httpServer, {
    cors: { origin: '*' },
    // Phones lose signal, tunnel, and background constantly. Be patient before
    // declaring someone gone — a 20s window survives a lift ride.
    pingTimeout: 20_000,
    pingInterval: 10_000,
    // Lets a dropped client resume its session (and its buffered events) rather
    // than reconnecting as a stranger.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  });

  // Authenticate on the handshake, not after connecting. An unauthenticated
  // socket should never reach a room.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Missing access token.'));

    try {
      const { sub } = verifyAccessToken(token);
      socket.data.userId = sub;
      next();
    } catch {
      next(new Error('Bad access token.'));
    }
  });

  io.on('connection', (socket: WatchlySocket) => {
    socket.on('session:join', async ({ sessionId }, ack) => {
      try {
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) return ack({ ok: false, message: 'That session no longer exists.' });

        const userId = socket.data.userId;
        const isA = session.personAId === userId;
        const isB = session.personBId === userId;

        // Only the two people in the session may listen in on it.
        if (!isA && !isB) return ack({ ok: false, message: 'That session no longer exists.' });

        if (session.status === 'ABANDONED') {
          return ack({ ok: false, message: 'This session timed out. Start a new one.' });
        }

        const voter: Voter = isA ? 'PERSON_A' : 'PERSON_B';
        socket.data.sessionId = sessionId;
        socket.data.voter = voter;

        await socket.join(room(sessionId));

        // Tell the partner we're back, if they're already here waiting.
        socket.to(room(sessionId)).emit('partner:reconnected');

        ack({ ok: true, voter });
      } catch (err) {
        console.error('session:join failed:', err);
        ack({ ok: false, message: 'Could not join that session.' });
      }
    });

    socket.on('disconnect', () => {
      const { sessionId } = socket.data;
      if (!sessionId) return;
      // Votes are already persisted server-side, so a drop costs nothing but the
      // partner's peace of mind — which is exactly what this event is for.
      socket.to(room(sessionId)).emit('partner:disconnected');
    });
  });

  console.log('Socket.io ready');
  return io;
}

/* --------------------------------------------------------------- emitters */
/* Called from the HTTP routes: votes still arrive over REST (they must persist
   even if the socket is down), and the socket layer only broadcasts the result. */

export function emitSessionJoined(
  sessionId: string,
  data: { personALabel: string; personBLabel: string; titleIds: string[] },
) {
  io?.to(room(sessionId)).emit('session:joined', data);
}

export function emitVoteSubmitted(sessionId: string, progress: SessionProgressPayload) {
  io?.to(room(sessionId)).emit('vote:submitted', { progress });
}

export function emitSessionCompleted(sessionId: string, progress: SessionProgressPayload) {
  io?.to(room(sessionId)).emit('session:completed', { progress });
}

export function emitSessionAbandoned(sessionId: string) {
  io?.to(room(sessionId)).emit('session:abandoned');
}
