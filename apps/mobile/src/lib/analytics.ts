import PostHog from 'posthog-react-native';
import type { Decision, TitleType, WatchKind } from '@watchly/shared';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;

export function initAnalytics() {
  if (!KEY || client) return;

  client = new PostHog(KEY, {
    host: HOST,
    flushAt: 20,
    flushInterval: 30_000,
  });
}

/** Ties events to an account after sign-in. */
export function identify(userId: string, props?: { region?: string; services?: number }) {
  client?.identify(userId, props);
}

export function resetAnalytics() {
  client?.reset();
}

/** PostHog only accepts JSON-serialisable values, hence the narrow type. */
type EventProps = Record<string, string | number | boolean | null>;

function capture(event: string, props?: EventProps) {
  client?.capture(event, props);
}

/* ------------------------------------------------------------------ events */

export const track = {
  sessionStarted(p: {
    mode: 'SAME_DEVICE' | 'MULTI_DEVICE';
    titleType: WatchKind;
    mood: string | null;
    maxRuntime: number | null;
  }) {
    capture('session_started', {
      mode: p.mode,
      title_type: p.titleType,
      mood: p.mood ?? 'any',
      max_runtime: p.maxRuntime ?? 0,
    });
  },

  cardSwiped(p: { index: number; total: number; decision: Decision; titleType: TitleType }) {
    capture('card_swiped', {
      index: p.index,
      total: p.total,
      decision: p.decision,
      title_type: p.titleType,
      is_last: p.index >= p.total - 1,
    });
  },

  resultsViewed(p: { matchCount: number; mode: string; titleType: TitleType }) {
    capture('results_viewed', {
      match_count: p.matchCount,
      // A high zero-match rate means the queue or the filters are wrong.
      had_match: p.matchCount > 0,
      mode: p.mode,
      title_type: p.titleType,
    });
  },

  /** The punchline: did anyone actually press play? */
  serviceOpened(p: { service: string; titleType: TitleType }) {
    capture('service_opened', { service: p.service, title_type: p.titleType });
  },

  trailerPlayed() {
    capture('trailer_played');
  },

  watchLogged(p: { watched: boolean }) {
    capture('watch_logged', { watched: p.watched });
  },
};
