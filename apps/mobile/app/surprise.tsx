import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { WATCH_KINDS, type TitleType } from '@watchly/shared';
import { Button, Heading, Screen } from '../src/components/ui';
import { ErrorState } from '../src/components/states';
import { TrailerModal } from '../src/components/TrailerModal';
import { PlayButtons } from '../src/components/PlayButtons';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import { track } from '../src/lib/analytics';
import type { PublicTitle } from '../src/lib/types';
import { colors, radii, spacing, type } from '../src/theme';

/**
 * "Surprise us" — one pick, no swiping, for the nights when fifteen trailers is
 * too much work. The server biases the choice toward what this person actually
 * says yes to, so it feels like the app knows you rather than rolling a die.
 */
export default function Surprise() {
  const router = useRouter();
  const user = useUser();

  const [kind, setKind] = useState<TitleType>('MOVIE');
  const [title, setTitle] = useState<PublicTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);

  const roll = useCallback(async (t: TitleType) => {
    setLoading(true);
    setFailed(false);
    setTitle(null);
    try {
      const res = await api<{ title: PublicTitle }>(`/api/titles/surprise?titleType=${t}`);
      setTitle(res.title);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    roll(kind);
  }, [kind, roll]);

  const again = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    roll(kind);
  };

  if (!user) return null;

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Surprise us</Heading>

        <View style={s.kindRow}>
          {WATCH_KINDS.map((k) => (
            <Pressable
              key={k.id}
              onPress={() => setKind(k.id)}
              style={({ pressed }) => [
                s.kindChip,
                kind === k.id && s.kindChipActive,
                pressed && s.pressed,
              ]}
            >
              <Text style={[s.kindText, kind === k.id && s.kindTextActive]}>
                {k.emoji} {k.id === 'TV' ? 'Series' : 'Movie'}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.red} />
            <Text style={s.loadingText}>Finding you something…</Text>
          </View>
        ) : failed || !title ? (
          <View style={s.loading}>
            <ErrorState
              title="Couldn’t find a pick."
              message="Add a service, or try again in a moment."
              onRetry={again}
            />
          </View>
        ) : (
          <Animated.View key={title.id} entering={FadeIn.duration(400)} style={s.pick}>
            <Pressable
              onPress={() => {
                if (title.trailerYoutubeIds.length > 0) {
                  track.trailerPlayed();
                  setTrailerOpen(true);
                }
              }}
              style={({ pressed }) => [s.posterWrap, pressed && s.pressed]}
            >
              {title.posterUrl ? (
                <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
              ) : (
                <View style={[s.poster, s.posterEmpty]} />
              )}
              {title.trailerYoutubeIds.length > 0 && (
                <View style={s.playBadge}>
                  <Text style={s.playText}>▶ Trailer</Text>
                </View>
              )}
            </Pressable>

            <Text style={s.pickTitle}>{title.title}</Text>
            <Text style={s.pickFacts}>{facts(title)}</Text>

            <View style={s.pickButtons}>
              <PlayButtons title={title} region={user.region} />
            </View>
          </Animated.View>
        )}
      </ScrollView>

      <View style={s.footer}>
        <Button label="🎲  Surprise me again" onPress={again} variant="ghost" />
      </View>

      {title && (
        <TrailerModal
          visible={trailerOpen}
          videoIds={title.trailerYoutubeIds}
          title={title.title}
          onClose={() => setTrailerOpen(false)}
        />
      )}
    </Screen>
  );
}

function facts(t: PublicTitle): string {
  return [
    t.releaseYear,
    t.runtime && (t.type === 'TV' ? `${t.runtime}m eps` : `${t.runtime}m`),
    t.genres.slice(0, 2).join(', '),
    t.rating ? `★ ${t.rating.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xl, alignItems: 'center' },

  kindRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  kindChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindChipActive: { borderColor: colors.red, backgroundColor: colors.surfaceActive },
  kindText: { ...type.label, color: colors.textMuted },
  kindTextActive: { color: colors.text },

  loading: { marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md, alignSelf: 'stretch' },
  loadingText: { ...type.body, color: colors.textMuted },

  pick: { marginTop: spacing.xl, alignItems: 'center', alignSelf: 'stretch' },
  posterWrap: { borderRadius: radii.card, overflow: 'hidden' },
  poster: { width: 220, height: 330, borderRadius: radii.card, backgroundColor: colors.purple },
  posterEmpty: { opacity: 0.5 },
  playBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(13,4,24,0.75)',
  },
  playText: { ...type.caption, color: colors.text },

  pickTitle: { ...type.title, fontSize: 24, color: colors.text, marginTop: spacing.lg, textAlign: 'center' },
  pickFacts: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs, textAlign: 'center' },
  // The play buttons live full-width under the pick.
  pickButtons: { marginTop: spacing.lg, alignSelf: 'stretch' },

  footer: { paddingVertical: spacing.md },
  pressed: { opacity: 0.85 },
});
