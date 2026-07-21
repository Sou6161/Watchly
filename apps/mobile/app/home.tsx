import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { serviceById, type SessionSummary } from '@watchly/shared';
import { Button, Heading, Screen, Subheading } from '../src/components/ui';
import { EmptyState, ErrorState, HistoryRowSkeleton } from '../src/components/states';
import { HistoryRow } from '../src/components/HistoryRow';
import { WatchCheckCard } from '../src/components/WatchCheckCard';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import type { ActiveResponse, ActiveSession, WatchCheck, WatchCheckResponse } from '../src/lib/types';
import { colors, radii, spacing, type } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const user = useUser();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [watchCheck, setWatchCheck] = useState<WatchCheck | null>(null);
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Refetch on focus, not just on mount: coming back from a finished session
  // should show it in the list immediately, not after an app restart.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          // Just a peek — the full, filterable history lives on /nights.
          const res = await api<{ sessions: SessionSummary[] }>('/api/sessions?limit=3');
          if (cancelled) return;
          setSessions(res.sessions);
          setHistoryFailed(false);
        } catch {
          // History failing must never block the buttons — starting a session is
          // the point of this screen, and it doesn't need the history to work.
          if (cancelled) return;
          setSessions([]);
          setHistoryFailed(true);
        }
      })();

      // The watch-loop prompt, fetched independently so a slow or failed check
      // never delays the history or the buttons — it's a bonus, not the screen.
      (async () => {
        try {
          const res = await api<WatchCheckResponse>('/api/sessions/watch-check');
          if (!cancelled) setWatchCheck(res.check);
        } catch {
          if (!cancelled) setWatchCheck(null);
        }
      })();

      // Open async sessions — "waiting on them to finish". Also independent.
      (async () => {
        try {
          const res = await api<ActiveResponse>('/api/sessions/active');
          if (!cancelled) setActive(res.active);
        } catch {
          if (!cancelled) setActive([]);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [reloadKey]),
  );

  if (!user) return null;

  const services = user.services.map(serviceById).filter((s) => s !== undefined);

  return (
    <Screen>
      <View style={s.topBar}>
        <Link href="/taste" asChild>
          <Pressable hitSlop={12} style={{ marginRight: 16 }}>
            <Text style={s.profileLink}>Taste</Text>
          </Pressable>
        </Link>
        <Link href="/profile" asChild>
          <Pressable hitSlop={12}>
            <Text style={s.profileLink}>Profile</Text>
          </Pressable>
        </Link>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Evening, {user.displayName}.</Heading>
        <Subheading>Two people, fifteen trailers, one decision.</Subheading>

        {watchCheck && (
          <View style={s.watchCheck}>
            <WatchCheckCard check={watchCheck} onAnswered={() => setWatchCheck(null)} />
          </View>
        )}

        <View style={s.services}>
          {services.map((svc) => (
            <View key={svc.id} style={s.serviceTag}>
              <View style={[s.dot, { backgroundColor: svc.color }]} />
              <Text style={s.serviceLabel}>{svc.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.actions}>
          {/* One tap to start with a saved partner — the whole point of saving them. */}
          {user.partner && (
            <Button
              label={`Start with ${user.partner.displayName}`}
              onPress={() => router.push('/session/new?mode=MULTI_DEVICE')}
            />
          )}

          <Button
            label="Together on this phone"
            onPress={() => router.push('/session/new?mode=SAME_DEVICE')}
            variant={user.partner ? 'ghost' : 'primary'}
          />
          <Button
            label="On separate phones"
            onPress={() => router.push('/session/new?mode=MULTI_DEVICE')}
            variant="ghost"
          />
          <Button
            label="Join with a code"
            onPress={() => router.push('/session/join')}
            variant="ghost"
          />
        </View>

        {active.length > 0 && (
          <View style={s.active}>
            <Text style={s.historyLabel}>Still going</Text>
            {active.map((a) => (
              <ActiveRow
                key={a.session.id}
                active={a}
                onPress={() =>
                  router.push(
                    `/session/share?code=${a.session.code}&partner=${encodeURIComponent(a.partnerLabel)}`,
                  )
                }
              />
            ))}
          </View>
        )}

        <View style={s.history}>
          {sessions === null ? (
            <>
              <Text style={s.historyLabel}>Recent nights</Text>
              <HistoryRowSkeleton />
              <HistoryRowSkeleton />
            </>
          ) : historyFailed ? (
            <ErrorState
              title="Couldn’t load your history."
              message="Your past nights are safe — we just can’t reach them right now."
              onRetry={() => {
                setSessions(null);
                setReloadKey((k) => k + 1);
              }}
            />
          ) : sessions.length > 0 ? (
            <>
              <View style={s.historyHead}>
                <Text style={s.historyLabel}>Recent nights</Text>
                <Pressable hitSlop={8} onPress={() => router.push('/nights')}>
                  <Text style={s.seeAll}>See all ›</Text>
                </Pressable>
              </View>
              {sessions.map((session, i) => (
                <Animated.View key={session.id} entering={FadeIn.delay(60 * i).duration(320)}>
                  <HistoryRow
                    session={session}
                    onPress={() => router.push(`/session/${session.id}`)}
                  />
                </Animated.View>
              ))}
            </>
          ) : (
            <EmptyState
              emoji="🍿"
              title="No nights yet."
              message="Start a session and this is where they’ll pile up."
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** An open async night: "waiting on them", or "your turn" if you left cards unswiped. */
function ActiveRow({ active, onPress }: { active: ActiveSession; onPress: () => void }) {
  const { partnerLabel, progress, yourTurn, waitingOnPartner } = active;

  const line = yourTurn
    ? `Your turn — ${progress.personA >= progress.total ? partnerLabel : 'you'} still have cards`
    : waitingOnPartner
      ? `Waiting on ${partnerLabel} to finish their 15`
      : `In progress with ${partnerLabel}`;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.activeRow, pressed && s.rowPressed]}
    >
      <Text style={s.activeIcon}>{waitingOnPartner ? '⏳' : '👉'}</Text>
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {line}
        </Text>
        <Text style={s.rowMeta}>Tap to re-send the code</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: spacing.sm },
  profileLink: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.xl, paddingBottom: spacing.xl },

  watchCheck: { marginTop: spacing.xl },

  services: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  serviceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serviceLabel: { ...type.caption, color: colors.textMuted },

  actions: { gap: spacing.sm, marginTop: spacing.xl },

  active: { marginTop: spacing.xxl },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.gold,
    marginBottom: spacing.sm,
  },
  activeIcon: { fontSize: 22 },

  history: { marginTop: spacing.xxl },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  historyLabel: { ...type.label, color: colors.textMuted },
  seeAll: { ...type.caption, color: colors.gold },
  // Shared by ActiveRow (the async "still going" strip).
  rowPressed: { opacity: 0.8 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.label, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  chevron: { ...type.title, color: colors.textFaint },
});
