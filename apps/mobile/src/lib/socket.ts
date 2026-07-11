import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@watchly/shared';
import { API_URL } from './api';
import { loadTokens } from './tokens';

export type WatchlySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: WatchlySocket | null = null;

/**
 * One socket for the whole app, created lazily.
 *
 * The access token is attached on the handshake and lives 15 minutes — longer
 * than most sessions, but not all. `auth` is given as a callback rather than a
 * fixed value so that every reconnect attempt re-reads SecureStore and picks up
 * a token refreshed by the REST layer in the meantime. Passing the token once
 * would mean a socket that drops after expiry can never reconnect.
 */
export async function getSocket(): Promise<WatchlySocket> {
  if (socket?.connected) return socket;

  if (!socket) {
    socket = io(API_URL, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      // Phones drop signal constantly; keep trying, but back off so a dead server
      // doesn't get hammered.
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      auth: (cb) => {
        loadTokens().then((tokens) => cb({ token: tokens?.accessToken ?? '' }));
      },
    }) as WatchlySocket;
  }

  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
