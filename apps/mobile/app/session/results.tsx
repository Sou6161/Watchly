import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { serviceById, type Region } from '@watchly/shared';
import { Button, Heading, Screen } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { api } from '../../src/lib/api';
import { openInService } from '../../src/lib/deeplinks';
import type { PublicSession, PublicTitle } from '../../src/lib/types';
import { colors, radii, spacing, type } from '../../src/theme';

export default function Results() {
  const router = useRouter();
  const storeSession = useSessionStore((s) => s.session);
  const reset = useSessionStore((s) => s.reset);

  const [matches, setMatches] = useState<PublicTitle[] | null>(null);
  const [session, setSession] = useState<PublicSession | null>(storeSession);

  useEffect(() => {
    if (!storeSession) {
      router.replace('/home');
      return;
    }

    (async () => {
      try {
        const res = await api<{ session: PublicSession; matches: PublicTitle[] }>(
          `/api/sessions/${storeSession.id}/results`,
        );
        setSession(res.session);
        setMatches(res.matches);

        if (res.matches.length > 0) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch {
        setMatches([]);
      }
    })();
  }, [storeSession, router]);

  const done = () => {
    reset();
    router.replace('/home');
  };

  if (!session || matches === null) {
    return (
      <Screen>
        <View style={s.loading}>
          <Text style={s.loadingText}>Counting the yeses…</Text>
        </View>
      </Screen>
    );
  }

  if (matches.length === 0) {
    return (
      <Screen>
        <View style={s.empty}>
          <Animated.View entering={FadeIn.duration(500)}>
            <Heading>No overlap this time.</Heading>
            <Text style={s.emptyCopy}>
              Fifteen trailers and not one you both wanted. Honestly, that&apos;s its own kind of
              compatibility.
            </Text>
          </Animated.View>
        </View>
        <View style={s.footer}>
          {/* "Swipe 10 more?" — a fresh deck excludes everything just swiped. */}
          <Button label="Swipe 15 more" onPress={() => router.replace('/session/new')} />
          <Button label="Call it a night" onPress={done} variant="ghost" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Animated.View entering={FadeIn.duration(600)}>
          <Text style={s.celebrate}>
            You both said yes to {matches.length} thing{matches.length === 1 ? '' : 's'} tonight.
          </Text>
        </Animated.View>

        {matches.map((t, i) => (
          <Animated.View key={t.id} entering={FadeInDown.delay(120 * i).duration(420)}>
            <MatchCard title={t} region={session.region} />
          </Animated.View>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <Button label="Done" onPress={done} />
      </View>
    </Screen>
  );
}

function MatchCard({ title, region }: { title: PublicTitle; region: Region }) {
  // Only the services this title actually streams on, in this session's region.
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
      {/* Poster and text sit on one row; the play buttons get the full card width
          below, so a long service name never has to share a line with the poster. */}
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
            style={({ pressed }) => [
              s.serviceBtn,
              { borderColor: svc.color },
              pressed && s.pressed,
            ]}
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
  content: { paddingTop: spacing.xl, paddingBottom: spacing.lg },
  celebrate: { ...type.hero, color: colors.gold, marginBottom: spacing.xl },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { ...type.body, color: colors.textMuted },

  empty: { flex: 1, justifyContent: 'center' },
  emptyCopy: { ...type.body, color: colors.textMuted, marginTop: spacing.md },

  match: {
    // OPAQUE, not translucent. Android draws the elevation shadow against the
    // view's backing rect, so a see-through background (rgba white 0.06) leaked a
    // pale ghost box out past the rounded corners. A solid surface fixes it.
    backgroundColor: '#241640',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    // Keeps the poster's square corners inside the card's rounded ones.
    overflow: 'hidden',
    shadowColor: colors.red,
    shadowOpacity: 0.15,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  matchTop: { flexDirection: 'row', gap: spacing.md },
  poster: {
    width: 84,
    // 2:3 is the poster aspect TMDB actually ships; 92x138 was close but off, so
    // art came out subtly squashed.
    height: 126,
    borderRadius: radii.sm,
    backgroundColor: colors.purple,
  },
  posterEmpty: { opacity: 0.5 },
  // minWidth:0 lets the text column actually shrink. Without it a long unbroken
  // title pushes the row wider than the card and overflows the right edge.
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
  footer: { gap: spacing.sm, paddingVertical: spacing.md },
});
