import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { Region } from '@watchly/shared';
import { Heading, Screen, Subheading } from '../src/components/ui';
import { EmptyState, ErrorState, MatchCardSkeleton } from '../src/components/states';
import { PlayButtons } from '../src/components/PlayButtons';
import { TrailerModal } from '../src/components/TrailerModal';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import { track } from '../src/lib/analytics';
import type { PublicTitle } from '../src/lib/types';
import { colors, radii, spacing, type } from '../src/theme';

/**
 * "On the fence" — every title you swiped MAYBE on, gathered in one place. The
 * one swipe that used to lead nowhere now builds a shortlist you can actually
 * come back to.
 */
export default function Watchlist() {
  const router = useRouter();
  const user = useUser();

  const [titles, setTitles] = useState<PublicTitle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState<PublicTitle | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ titles: PublicTitle[] }>('/api/titles/watchlist');
        if (!cancelled) {
          setTitles(res.titles);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (!user) return null;

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>On the fence</Heading>
        <Subheading>Everything you swiped “maybe” on — a shortlist for later.</Subheading>

        <View style={s.list}>
          {failed ? (
            <ErrorState
              title="Couldn’t load your list."
              message="It’s safe — this is just the connection."
              onRetry={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            />
          ) : titles === null ? (
            <>
              <MatchCardSkeleton />
              <MatchCardSkeleton />
            </>
          ) : titles.length === 0 ? (
            <EmptyState
              emoji="🤔"
              title="Nothing on the fence."
              message="Swipe “maybe” (down) on a trailer and it lands here for later."
            />
          ) : (
            titles.map((t, i) => (
              <Animated.View key={t.id} entering={FadeInDown.delay(60 * i).duration(360)}>
                <FenceCard title={t} region={user.region} onTrailer={() => setPlaying(t)} />
              </Animated.View>
            ))
          )}
        </View>
      </ScrollView>

      {playing && (
        <TrailerModal
          visible={!!playing}
          videoIds={playing.trailerYoutubeIds}
          title={playing.title}
          onClose={() => setPlaying(null)}
        />
      )}
    </Screen>
  );
}

function FenceCard({
  title,
  region,
  onTrailer,
}: {
  title: PublicTitle;
  region: Region;
  onTrailer: () => void;
}) {
  const facts = [
    title.releaseYear,
    title.runtime && (title.type === 'TV' ? `${title.runtime}m eps` : `${title.runtime}m`),
    title.genres.slice(0, 2).join(', '),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Pressable
          onPress={() => {
            if (title.trailerYoutubeIds.length > 0) {
              track.trailerPlayed();
              onTrailer();
            }
          }}
          style={({ pressed }) => pressed && s.pressed}
        >
          {title.posterUrl ? (
            <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
          ) : (
            <View style={[s.poster, s.posterEmpty]} />
          )}
        </Pressable>

        <View style={s.cardBody}>
          <Text style={s.cardTitle} numberOfLines={3}>
            {title.title}
          </Text>
          <Text style={s.cardFacts} numberOfLines={2}>
            {facts}
          </Text>
          {title.trailerYoutubeIds.length > 0 && <Text style={s.trailerHint}>▶ Tap poster for trailer</Text>}
        </View>
      </View>

      <View style={s.cardButtons}>
        <PlayButtons title={title} region={region} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  list: { marginTop: spacing.lg, gap: spacing.md },

  card: {
    backgroundColor: '#241640',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    overflow: 'hidden',
  },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  poster: { width: 84, height: 126, borderRadius: radii.sm, backgroundColor: colors.purple },
  posterEmpty: { opacity: 0.5 },
  cardBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  cardTitle: { ...type.title, fontSize: 19, lineHeight: 25, color: colors.text },
  cardFacts: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },
  trailerHint: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },
  cardButtons: { marginTop: spacing.md },
  pressed: { opacity: 0.85 },
});
