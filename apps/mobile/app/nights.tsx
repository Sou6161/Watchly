import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { SessionSummary, SessionsPage } from '@watchly/shared';
import { Chip, Heading, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, HistoryRowSkeleton } from '../src/components/states';
import { HistoryRow } from '../src/components/HistoryRow';
import { api } from '../src/lib/api';
import { colors, spacing, type } from '../src/theme';

const PAGE = 10;

type KindFilter = 'ALL' | 'MOVIE' | 'TV';
type ModeFilter = 'ALL' | 'SAME_DEVICE' | 'MULTI_DEVICE';

/**
 * The full history, on its own screen so it never piles up on home. Paginated
 * ("Load more") and filterable by kind and how you played, so finding a
 * particular night is a couple of taps rather than an endless scroll.
 */
export default function Nights() {
  const router = useRouter();

  const [kind, setKind] = useState<KindFilter>('ALL');
  const [mode, setMode] = useState<ModeFilter>('ALL');

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (kind !== 'ALL') params.set('titleType', kind);
      if (mode !== 'ALL') params.set('mode', mode);
      return `/api/sessions?${params.toString()}`;
    },
    [kind, mode],
  );

  // Reload from the top whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setFailed(false);
    (async () => {
      try {
        const res = await api<SessionsPage>(query(0));
        if (cancelled) return;
        setSessions(res.sessions);
        setHasMore(res.hasMore);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  const loadMore = async () => {
    if (loadingMore || !sessions) return;
    setLoadingMore(true);
    try {
      const res = await api<SessionsPage>(query(sessions.length));
      setSessions((prev) => [...(prev ?? []), ...res.sessions]);
      setHasMore(res.hasMore);
    } catch {
      // Leave what's loaded; the button stays so they can retry.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <View style={s.header}>
        <Heading>Your nights</Heading>
      </View>

      <View style={s.filters}>
        <View style={s.filterRow}>
          <Chip label="All" selected={kind === 'ALL'} onPress={() => setKind('ALL')} />
          <Chip label="🎬 Movies" selected={kind === 'MOVIE'} onPress={() => setKind('MOVIE')} />
          <Chip label="📺 Series" selected={kind === 'TV'} onPress={() => setKind('TV')} />
        </View>
        <View style={s.filterRow}>
          <Chip label="Any way" selected={mode === 'ALL'} onPress={() => setMode('ALL')} />
          <Chip
            label="One phone"
            selected={mode === 'SAME_DEVICE'}
            onPress={() => setMode('SAME_DEVICE')}
          />
          <Chip
            label="Separate"
            selected={mode === 'MULTI_DEVICE'}
            onPress={() => setMode('MULTI_DEVICE')}
          />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {failed ? (
          <ErrorState
            title="Couldn’t load your nights."
            message="They’re safe — this is just the connection."
            onRetry={() => setAttempt((a) => a + 1)}
          />
        ) : sessions === null ? (
          <>
            <HistoryRowSkeleton />
            <HistoryRowSkeleton />
            <HistoryRowSkeleton />
          </>
        ) : sessions.length === 0 ? (
          <EmptyState
            emoji="🍿"
            title="Nothing here."
            message="No nights match that filter yet."
          />
        ) : (
          <>
            {sessions.map((session) => (
              <HistoryRow
                key={session.id}
                session={session}
                onPress={() => router.push(`/session/${session.id}`)}
              />
            ))}

            {hasMore && (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                style={({ pressed }) => [s.loadMore, pressed && s.pressed]}
              >
                {loadingMore ? (
                  <ActivityIndicator color={colors.textMuted} />
                ) : (
                  <Text style={s.loadMoreText}>Load more</Text>
                )}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  header: { marginTop: spacing.md },
  filters: { gap: spacing.sm, marginTop: spacing.lg },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  loadMore: { alignSelf: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  loadMoreText: { ...type.label, color: colors.textMuted },
  pressed: { opacity: 0.7 },
});
