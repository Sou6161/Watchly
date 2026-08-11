import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@watchly/shared';
import { API_URL } from './api';
import { loadTokens } from './tokens';

export type WatchlySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: WatchlySocket | null = null;

export async function getSocket(): Promise<WatchlySocket> {
  if (socket?.connected) return socket;

  if (!socket) {
    socket = io(API_URL, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
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
