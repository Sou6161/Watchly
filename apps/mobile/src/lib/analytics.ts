import PostHog from 'posthog-react-native';
import type { Decision, TitleType, WatchKind } from '@watchly/shared';

/**
 * Analytics.
 *
 * Deliberately a thin wrapper rather than importing PostHog directly at call
 * sites: it keeps the event vocabulary in one place (so nobody invents
 * `session_start` next to `session_started`), and it makes the whole thing a
 * silent no-op when no key is configured — which is how the test suite, and any
 * fork of this repo, avoid sending someone else's data to our project.
 *
 * FOUR events, chosen because each answers a question that decides whether the
 * product works. A dashboard of forty generic screen_views answers none:
 *
 *   session_started  — which modes/moods/kinds people actually pick
 *   card_swiped      — DO THEY REACH CARD 15? the whole premise is that 15 is right
 *   results_viewed   — how often is the answer zero matches?
 *   service_opened   — the punchline. matches are worthless if nobody presses play
 */

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;

export function initAnalytics() {
  if (!KEY || client) return;

  client = new PostHog(KEY, {
    host: HOST,
    // Batch rather than firing per event — a swipe deck produces 15 events in
    // quick succession and each one must not cost a round trip mid-gesture.
    flushAt: 20,
    flushInterval: 30_000,
  });
}

/** Ties events to an account after sign-in. */
export function identify(userId: string, props?: { region?: string; services?: number }) {
  client?.identify(userId, props);
}

/**
 * Called on sign-out. Without this, the next person to sign in on the same phone
 * inherits the previous user's identity and their events merge together.
 */
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
      // 'any' rather than null so it groups cleanly in a breakdown — PostHog
      // treats null as "property missing", which hides it from charts.
      mood: p.mood ?? 'any',
      max_runtime: p.maxRuntime ?? 0,
    });
  },

  /**
   * The most valuable event here. `index` is what reveals whether people finish
   * the deck or quietly give up around card 6 — which would mean 15 is the wrong
   * number and the core mechanic needs rethinking.
   */
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

  /**
   * Trailer playback is opt-in since tap-to-play replaced autoplay, so this is how
   * we learn whether people actually want the trailer — or whether the poster and
   * title are enough to decide on.
   */
  trailerPlayed() {
    capture('trailer_played');
  },

  /**
   * The watch-loop close. `watched: true` is the strongest evidence the whole
   * product works — two people agreed AND then actually watched it together.
   */
  watchLogged(p: { watched: boolean }) {
    capture('watch_logged', { watched: p.watched });
  },
};
