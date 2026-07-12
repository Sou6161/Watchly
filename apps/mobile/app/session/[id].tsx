import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { moodById, serviceById, type Region } from '@watchly/shared';
import { Heading, Screen, Subheading } from '../../src/components/ui';
import { ErrorState, MatchCardSkeleton } from '../../src/components/states';
import { api } from '../../src/lib/api';
import { openInService } from '../../src/lib/deeplinks';
import type { PublicTitle, ResultsResponse } from '../../src/lib/types';
import { colors, radii, spacing, type } from '../../src/theme';

/**
 * Revisiting a past session. Read-only: the matches are already decided, so this
 * is purely "what did we agree on that night, and where do I press play".
 */
export default function PastSession() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<ResultsResponse>(`/api/sessions/${id}/results`);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setError('It might have been cleared, or you might be offline.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (error) {
    return (
      <Screen>
        <View style={s.center}>
          <ErrorState
            title="Couldn’t open that night."
            message={error}
            onRetry={() => {
              setError('');
              setAttempt((a) => a + 1);
            }}
          />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          <MatchCardSkeleton />
          <MatchCardSkeleton />
        </ScrollView>
      </Screen>
    );
  }

  const { session, matches } = data;
  const mood = session.mood ? moodById(session.mood) : undefined;
  const when = session.completedAt
    ? new Date(session.completedAt).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '';

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>
          {session.personALabel} &amp; {session.personBLabel}
        </Heading>
        <Subheading>
          {[when, mood && `${mood.emoji} ${mood.label}`].filter(Boolean).join('  ·  ')}
        </Subheading>

        <Text style={s.count}>
          {matches.length === 0
            ? 'No overlap that night.'
            : `${matches.length} thing${matches.length === 1 ? '' : 's'} you both said yes to.`}
        </Text>

        {matches.map((t, i) => (
          <Animated.View key={t.id} entering={FadeInDown.delay(80 * i).duration(360)}>
            <MatchCard title={t} region={session.region} />
          </Animated.View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function MatchCard({ title, region }: { title: PublicTitle; region: Region }) {
  const services = (title.watchProviders[region]?.flatrate ?? [])
    .map(serviceById)
    .filter((svc) => svc !== undefined);

  const facts = [
    title.releaseYear,
    title.runtime && (title.type === 'TV' ? `${title.runtime}m eps` : `${title.runtime}m`),
    title.genres.slice(0, 2).join(', '),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={s.match}>
      <View style={s.matchTop}>
        {title.posterUrl ? (
          <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
        ) : (
          <View style={[s.poster, s.posterEmpty]} />
        )}
        <View style={s.matchBody}>
          <Text style={s.matchTitle} numberOfLines={3}>
            {title.title}
          </Text>
          <Text style={s.matchFacts} numberOfLines={2}>
            {facts}
          </Text>
        </View>
      </View>

      <View style={s.services}>
        {services.map((svc) => (
          <Pressable
            key={svc.id}
            accessibilityRole="button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              openInService(svc.id, title.title);
            }}
            style={({ pressed }) => [s.serviceBtn, { borderColor: svc.color }, pressed && s.pressed]}
          >
            <View style={[s.dot, { backgroundColor: svc.color }]} />
            <Text style={s.serviceLabel} numberOfLines={1}>
              Play on {svc.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  count: { ...type.body, color: colors.gold, marginTop: spacing.xl, marginBottom: spacing.md },

  match: {
    backgroundColor: '#241640',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  matchTop: { flexDirection: 'row', gap: spacing.md },
  poster: { width: 84, height: 126, borderRadius: radii.sm, backgroundColor: colors.purple },
  posterEmpty: { opacity: 0.5 },
  matchBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  matchTitle: { ...type.title, fontSize: 19, lineHeight: 25, color: colors.text },
  matchFacts: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },

  services: { marginTop: spacing.md, gap: spacing.sm },
  serviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serviceLabel: { ...type.label, color: colors.text, flexShrink: 1 },
});
