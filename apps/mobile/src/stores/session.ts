import { create } from 'zustand';
import type { Decision, SessionProgressPayload, Voter } from '@watchly/shared';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { track } from '../lib/analytics';
import type { PublicSession, PublicTitle } from '../lib/types';

/**
 * Where we are in a session.
 *
 * SAME_DEVICE runs PERSON_A -> HANDOFF -> PERSON_B -> DONE on one phone.
 * MULTI_DEVICE runs SWIPING -> WAITING_FOR_PARTNER -> DONE on each phone
 * independently; the server decides when both are finished.
 */
export type Phase =
  | 'PERSON_A'
  | 'HANDOFF'
  | 'PERSON_B'
  | 'SWIPING'
  | 'WAITING_FOR_PARTNER'
  // Async: this phone finished its deck and there's nothing to wait on live —
  // person B will pick it up whenever. The swipe screen shows the code to share.
  | 'ASYNC_DONE'
  | 'DONE';

interface SessionStore {
  session: PublicSession | null;
  titles: PublicTitle[];

  index: number;
  phase: Phase;
  votes: Record<string, Decision>;

  /** Multi-device only: which side this phone is. */
  voter: Voter;
  progress: SessionProgressPayload | null;
  partnerConnected: boolean;
  /** Set when the server abandons the session out from under us. */
  abandoned: boolean;

  creating: boolean;
  error: string | null;

  create: (opts: CreateOpts) => Promise<{ id: string; mode: string } | null>;
  join: (code: string) => Promise<string | null>;
  connect: () => Promise<void>;
  vote: (decision: Decision) => Promise<void>;
  reset: () => void;
}

interface CreateOpts {
  mode: 'SAME_DEVICE' | 'MULTI_DEVICE';
  /** Movie night or series night — never a deck with both. */
  titleType: 'MOVIE' | 'TV';
  mood?: string | null;
  maxRuntime?: number | null;
  /** Extra rules, sent as ids the server resolves. Omitted = no-op. */
  era?: string;
  rating?: string;
  language?: string;
  deckSize?: number;
  personALabel?: string;
  personBLabel?: string;
  /** Multi-device only: swipe now, let person B finish later. */
  async?: boolean;
}

const initial = {
  session: null,
  titles: [] as PublicTitle[],
  index: 0,
  phase: 'PERSON_A' as Phase,
  votes: {} as Record<string, Decision>,
  voter: 'PERSON_A' as Voter,
  progress: null,
  partnerConnected: false,
  abandoned: false,
  creating: false,
  error: null,
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initial,

  create: async (opts) => {
    set({ ...initial, creating: true });
    try {
      const res = await api<{ session: PublicSession; titles: PublicTitle[] }>('/api/sessions', {
        method: 'POST',
        body: opts,
      });
      set({
        session: res.session,
        titles: res.titles,
        creating: false,
        voter: 'PERSON_A',
        // Multi-device (live or async) starts person A swiping right away; only
        // same-device opens on the person-A name gate.
        phase: opts.mode === 'MULTI_DEVICE' ? 'SWIPING' : 'PERSON_A',
      });
      return { id: res.session.id, mode: res.session.mode };
    } catch (e) {
      set({ creating: false, error: e instanceof Error ? e.message : 'Could not start a session.' });
      return null;
    }
  },

  join: async (code) => {
    set({ ...initial, creating: true });
    try {
      const res = await api<{ session: PublicSession; titles: PublicTitle[] }>(
        `/api/sessions/${code.trim().toUpperCase()}/join`,
        { method: 'POST' },
      );
      set({
        session: res.session,
        titles: res.titles,
        creating: false,
        // Whoever joins by code is always person B.
        voter: 'PERSON_B',
        phase: 'SWIPING',
        partnerConnected: true,
      });
      return res.session.id;
    } catch (e) {
      set({ creating: false, error: e instanceof Error ? e.message : 'Could not join.' });
      return null;
    }
  },

  /** Opens the socket and subscribes to this session's room. LIVE multi-device only. */
  connect: async () => {
    const { session } = get();
    // Async sessions have no live partner to sync with — no socket, no lobby.
    if (!session || session.mode !== 'MULTI_DEVICE' || session.isAsync) return;

    const socket = await getSocket();

    // Re-registered on every call, so clear first — otherwise a reconnect stacks
    // duplicate handlers and every event fires N times.
    socket.off('session:joined');
    socket.off('vote:submitted');
    socket.off('session:completed');
    socket.off('partner:disconnected');
    socket.off('partner:reconnected');
    socket.off('session:abandoned');

    socket.on('session:joined', ({ personBLabel }) => {
      const s = get().session;
      if (!s) return;
      set({
        session: { ...s, personBLabel, status: 'IN_PROGRESS' },
        partnerConnected: true,
      });
    });

    socket.on('vote:submitted', ({ progress }) => set({ progress }));

    socket.on('session:completed', ({ progress }) => {
      // The server decides the session is over, not the client — so both phones
      // land on results together even if one is mid-animation.
      set({ progress, phase: 'DONE' });
    });

    socket.on('partner:disconnected', () => set({ partnerConnected: false }));
    socket.on('partner:reconnected', () => set({ partnerConnected: true }));
    socket.on('session:abandoned', () => set({ abandoned: true }));

    const ack = await socket.emitWithAck('session:join', { sessionId: session.id });
    if (!ack.ok) set({ error: ack.message, abandoned: true });
  },

  /**
   * Records a swipe and advances.
   *
   * The vote is sent but NOT awaited: the card has already flown off screen and
   * the next one is up, so blocking on a round-trip would stutter the one
   * interaction that has to feel perfect. The endpoint is idempotent per
   * (session, title, voter), so a retry or duplicate is harmless.
   */
  vote: async (decision) => {
    const { session, titles, index, phase, votes, voter } = get();
    if (!session) return;

    const title = titles[index];
    if (!title) return;

    const multi = session.mode === 'MULTI_DEVICE';
    const asVoter: Voter = multi ? voter : phase === 'PERSON_B' ? 'PERSON_B' : 'PERSON_A';
    const last = index >= titles.length - 1;
    const asyncMulti = multi && session.isAsync;
    const body = { titleId: title.id, voter: asVoter, decision };

    // Fired here rather than in the card component: every swipe funnels through
    // this one function, so there is no path that silently skips instrumentation.
    track.cardSwiped({
      index,
      total: titles.length,
      decision,
      titleType: session.titleType,
    });

    const nextVotes = { ...votes, [`${asVoter}:${title.id}`]: decision };

    // The FINAL async swipe is the one case we await: its response tells us
    // whether this swipe completed the whole session (person B was already done)
    // or merely handed off (they haven't started). Every other swipe stays
    // fire-and-forget so the deck never stutters on a round trip.
    if (asyncMulti && last) {
      let bothDone = false;
      try {
        const res = await api<{ progress: SessionProgressPayload }>(
          `/api/sessions/${session.id}/votes`,
          { method: 'POST', body },
        );
        bothDone = res.progress.bothDone;
        set({ progress: res.progress });
      } catch {
        // Treat a failed final vote as "not complete" — the share screen invites
        // them to come back, and the vote retries idempotently if they do.
      }
      set({ phase: bothDone ? 'DONE' : 'ASYNC_DONE', votes: nextVotes });
      return;
    }

    api(`/api/sessions/${session.id}/votes`, { method: 'POST', body }).catch(() => {
      // Swallowed on purpose — see above. Losing one vote must not break the run.
    });

    if (!last) {
      set({ index: index + 1, votes: nextVotes });
      return;
    }

    if (multi) {
      // Done with our deck, but the other phone may still be going. The server
      // emits session:completed when both are finished; until then, we wait.
      set({ phase: 'WAITING_FOR_PARTNER', votes: nextVotes });
      return;
    }

    const nextPhase: Phase = phase === 'PERSON_A' ? 'HANDOFF' : 'DONE';
    set({
      phase: nextPhase,
      // Person B starts over at the top of the same deck, in the same order.
      index: nextPhase === 'HANDOFF' ? 0 : index,
      votes: nextVotes,
    });

    if (nextPhase === 'DONE') {
      await api(`/api/sessions/${session.id}/complete`, { method: 'POST' }).catch(() => {});
    }
  },

  reset: () => set({ ...initial }),
}));

/** Called from the handoff screen when person B takes the phone. */
export function startPersonB() {
  useSessionStore.setState({ phase: 'PERSON_B', index: 0 });
}
