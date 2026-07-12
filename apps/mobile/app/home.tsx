import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { moodById, serviceById, type SessionSummary } from '@watchly/shared';
import { Button, Heading, Screen, Subheading } from '../src/components/ui';
import { EmptyState, ErrorState, HistoryRowSkeleton } from '../src/components/states';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import { colors, radii, spacing, type } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const user = useUser();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Refetch on focus, not just on mount: coming back from a finished session
  // should show it in the list immediately, not after an app restart.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await api<{ sessions: SessionSummary[] }>('/api/sessions?limit=5');
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
        <Link href="/profile" asChild>
          <Pressable hitSlop={12}>
            <Text style={s.profileLink}>Profile</Text>
          </Pressable>
        </Link>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Evening, {user.displayName}.</Heading>
        <Subheading>Two people, fifteen trailers, one decision.</Subheading>

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
              <Text style={s.historyLabel}>Recent nights</Text>
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

function HistoryRow({ session, onPress }: { session: SessionSummary; onPress: () => void }) {
  const mood = session.mood ? moodById(session.mood) : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      {/* A little stack of the matched posters — the fastest way to recognise a
          night you half-remember. */}
      <View style={s.stack}>
        {session.matchPosters.length > 0 ? (
          session.matchPosters.map((uri, i) => (
            <Image
              key={uri}
              source={{ uri }}
              style={[s.stackPoster, { left: i * 14, zIndex: 3 - i }]}
              resizeMode="cover"
            />
          ))
        ) : (
          <View style={[s.stackPoster, s.stackEmpty]} />
        )}
      </View>

      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {session.matchCount > 0
            ? `${session.matchCount} match${session.matchCount === 1 ? '' : 'es'} with ${session.partnerLabel}`
            : `No overlap with ${session.partnerLabel}`}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[mood && `${mood.emoji} ${mood.label}`, formatWhen(session.completedAt)]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      </View>

      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

/** Relative for the recent past, absolute once it stops being "the other night". */
function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);

  if (days <= 0) return 'Tonight';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const s = StyleSheet.create({
  topBar: { alignItems: 'flex-end', paddingTop: spacing.sm },
  profileLink: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.xl, paddingBottom: spacing.xl },

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

  history: { marginTop: spacing.xxl },
  historyLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    // Opaque, not translucent — Android renders elevation/borders against the
    // backing rect and a see-through fill leaks a pale box past the corners.
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  rowPressed: { opacity: 0.8 },
  stack: { width: 68, height: 54, justifyContent: 'center' },
  stackPoster: {
    position: 'absolute',
    width: 36,
    height: 54,
    borderRadius: 4,
    backgroundColor: colors.purple,
    borderWidth: 1,
    borderColor: colors.bgBottom,
  },
  stackEmpty: { opacity: 0.4 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.label, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  chevron: { ...type.title, color: colors.textFaint },
});
