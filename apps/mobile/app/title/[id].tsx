import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PlayButtons } from '../../src/components/PlayButtons';
import { TrailerModal } from '../../src/components/TrailerModal';
import { ErrorState } from '../../src/components/states';
import { useUser } from '../../src/stores/auth';
import { api } from '../../src/lib/api';
import { track } from '../../src/lib/analytics';
import type { TitleDetail, TitleRecommendation } from '../../src/lib/types';
import { colors, radii, spacing, type } from '../../src/theme';

/** ISO-639-1 -> a human name, for the languages this catalogue actually returns.
 *  Falls back to the raw code for anything outside this list rather than guessing. */
const LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi',
  en: 'English',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  ur: 'Urdu',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  zh: 'Chinese',
  it: 'Italian',
};

/**
 * The details screen — reached by tapping a title's name (and, wherever the
 * poster isn't already spoken for by "tap for trailer", the poster too). The
 * one place in the app that shows the plot: every card and list deliberately
 * withholds it to avoid spoiling a decision still being made, but once someone
 * has tapped through here they've already asked for more.
 */
export default function TitleDetails() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [trailerOpen, setTrailerOpen] = useState(false);
  // Which recommendation is mid-resolve, so only THAT thumbnail shows a spinner
  // rather than blocking the whole screen for what's usually a sub-second lookup.
  const [resolving, setResolving] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ title: TitleDetail }>(`/api/titles/${id}`);
        if (!cancelled) {
          setTitle(res.title);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const BackButton = (
    <Pressable
      hitSlop={12}
      onPress={() => router.back()}
      style={({ pressed }) => [s.backBtn, { top: insets.top + spacing.sm }, pressed && s.pressed]}
    >
      <BlurView intensity={40} tint="dark" style={s.backBlur}>
        <Text style={s.backGlyph}>‹</Text>
      </BlurView>
    </Pressable>
  );

  if (failed) {
    return (
      <View style={s.center}>
        {BackButton}
        <ErrorState
          title="Couldn’t load this one."
          message="It’s safe — this is just the connection."
          onRetry={() => {
            setFailed(false);
            setAttempt((a) => a + 1);
          }}
        />
      </View>
    );
  }

  if (!title || !user) {
    return (
      <View style={s.center}>
        {BackButton}
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  const certification = title.certifications[user.region];
  const facts = [
    title.releaseYear,
    title.runtime && (title.type === 'TV' ? `${title.runtime}m / episode` : `${title.runtime}m`),
    title.language && (LANGUAGE_NAMES[title.language] ?? title.language.toUpperCase()),
  ].filter(Boolean);

  /** A "more like this" tap has no title id yet — only a tmdbId. Resolve it into
   *  a real, cached title first, then navigate exactly like any other tap. */
  const openRecommendation = async (rec: TitleRecommendation) => {
    if (resolving !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResolving(rec.tmdbId);
    try {
      const res = await api<{ title: TitleDetail }>('/api/titles/resolve', {
        method: 'POST',
        body: { tmdbId: rec.tmdbId, type: rec.type },
      });
      router.push(`/title/${res.title.id}`);
    } catch {
      // Non-fatal — this is a bonus row, not the point of the screen. The
      // thumbnail just stops spinning and nothing happens.
    } finally {
      setResolving(null);
    }
  };

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        {/* Cinematic hero. A real backdrop shot renders crisp and full quality —
            it's already a wide, hero-shaped image. Older cached titles from
            before backdrops were tracked (or the rare TMDB entry with none) fall
            back to the poster itself, softened into a backdrop with a blur.
            Full-bleed under the status bar on purpose — a details page is the
            one screen in the app that earns an edge-to-edge moment. */}
        <View style={s.hero}>
          {title.backdropUrl ? (
            <Image source={{ uri: title.backdropUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : title.posterUrl ? (
            <Image
              source={{ uri: title.posterUrl }}
              style={StyleSheet.absoluteFill}
              blurRadius={28}
              resizeMode="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, s.heroEmpty]} />
          )}
          <View style={[StyleSheet.absoluteFill, s.heroTint]} />
          <LinearGradient
            colors={['transparent', colors.bgBottom]}
            style={s.heroFade}
            locations={[0, 0.92]}
          />

          <Animated.View entering={FadeIn.duration(420)} style={[s.posterCard, { marginTop: insets.top + 44 }]}>
            {title.posterUrl ? (
              <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
            ) : (
              <View style={[s.poster, s.posterEmpty]} />
            )}
          </Animated.View>
        </View>

        <Animated.View entering={FadeInDown.delay(80).duration(420)} style={s.body}>
          <Text style={s.title}>{title.title}</Text>

          {(facts.length > 0 || certification) && (
            <View style={s.factsRow}>
              {certification && (
                <View style={s.certBadge}>
                  <Text style={s.certText}>{certification}</Text>
                </View>
              )}
              {facts.map((f, i) => (
                <View key={i} style={s.factGroup}>
                  {(i > 0 || certification) && <View style={s.factDot} />}
                  <Text style={s.fact}>{f}</Text>
                </View>
              ))}
              {title.rating != null && (
                <View style={s.factGroup}>
                  <View style={s.factDot} />
                  <Text style={s.ratingStar}>★</Text>
                  <Text style={s.fact}>{title.rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
          )}

          {title.genres.length > 0 && (
            <View style={s.genres}>
              {title.genres.map((g) => (
                <View key={g} style={s.genreChip}>
                  <Text style={s.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}

          {title.trailerYoutubeIds.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                track.trailerPlayed();
                setTrailerOpen(true);
              }}
              style={({ pressed }) => [s.trailerBtn, pressed && s.pressed]}
            >
              <Text style={s.trailerGlyph}>▶</Text>
              <Text style={s.trailerLabel}>
                {title.trailerYoutubeIds.length > 1 ? 'Watch trailers' : 'Watch trailer'}
              </Text>
            </Pressable>
          )}

          {title.overview && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>About</Text>
              <Text style={s.overview}>{title.overview}</Text>
            </View>
          )}

          {title.topCast.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Cast</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.castRow}
              >
                {title.topCast.map((c, i) => (
                  <View key={`${c.name}-${i}`} style={s.castCard}>
                    {c.profileUrl ? (
                      <Image source={{ uri: c.profileUrl }} style={s.castPhoto} resizeMode="cover" />
                    ) : (
                      <View style={[s.castPhoto, s.castPhotoEmpty]}>
                        <Text style={s.castInitial}>{c.name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={s.castName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={s.castCharacter} numberOfLines={1}>
                      {c.character}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.section}>
            <PlayButtons title={title} region={user.region} />
          </View>

          {title.recommendations.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>More like this</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.recRow}
              >
                {title.recommendations.map((rec) => (
                  <Pressable
                    key={rec.tmdbId}
                    onPress={() => openRecommendation(rec)}
                    disabled={resolving !== null}
                    style={({ pressed }) => [s.recCard, pressed && s.pressed]}
                  >
                    {rec.posterUrl ? (
                      <Image source={{ uri: rec.posterUrl }} style={s.recPoster} resizeMode="cover" />
                    ) : (
                      <View style={[s.recPoster, s.posterEmpty]} />
                    )}
                    {resolving === rec.tmdbId && (
                      <View style={[StyleSheet.absoluteFill, s.recLoading]}>
                        <ActivityIndicator color={colors.text} size="small" />
                      </View>
                    )}
                    <Text style={s.recTitle} numberOfLines={2}>
                      {rec.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {BackButton}

      <TrailerModal
        visible={trailerOpen}
        videoIds={title.trailerYoutubeIds}
        title={title.title}
        onClose={() => setTrailerOpen(false)}
      />
    </View>
  );
}

const HERO_HEIGHT = 260;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBottom },
  center: { flex: 1, backgroundColor: colors.bgBottom, alignItems: 'center', justifyContent: 'center' },

  backBtn: { position: 'absolute', left: spacing.lg, zIndex: 10 },
  backBlur: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  backGlyph: { ...type.title, fontSize: 22, color: colors.text, marginTop: -2 },
  pressed: { opacity: 0.75 },

  hero: { height: HERO_HEIGHT, alignItems: 'center' },
  heroEmpty: { backgroundColor: colors.purple },
  heroTint: { backgroundColor: 'rgba(13,4,24,0.55)' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: HERO_HEIGHT * 0.7 },

  posterCard: {
    borderRadius: radii.card,
    overflow: 'hidden',
    shadowColor: colors.red,
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  poster: { width: 130, height: 195, borderRadius: radii.card, backgroundColor: colors.purple },
  posterEmpty: { opacity: 0.5 },

  // The poster card can overhang the hero's fixed height slightly on devices
  // with a tall safe-area inset, so this needs real clearance, not just the
  // usual spacing.lg gap — otherwise the title crowds right up against it.
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  title: { ...type.hero, fontSize: 30, lineHeight: 36, color: colors.text, textAlign: 'center' },

  factsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  factGroup: { flexDirection: 'row', alignItems: 'center' },
  factDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.textFaint,
    marginHorizontal: spacing.sm,
  },
  fact: { ...type.caption, color: colors.textMuted },
  ratingStar: { ...type.caption, color: colors.gold, marginRight: 3 },
  certBadge: {
    borderWidth: 1,
    borderColor: colors.textFaint,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: spacing.sm,
  },
  certText: { ...type.caption, color: colors.textMuted, fontSize: 11 },

  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  genreChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreText: { ...type.caption, color: colors.textMuted },

  trailerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.red,
  },
  trailerGlyph: { color: '#fff', fontSize: 14 },
  trailerLabel: { ...type.button, color: '#fff' },

  section: { marginTop: spacing.xl },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 12,
  },
  overview: { ...type.body, color: colors.text, lineHeight: 24 },

  castRow: { gap: spacing.md },
  castCard: { width: 78, alignItems: 'center' },
  castPhoto: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.purple },
  castPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  castInitial: { ...type.title, fontSize: 22, color: colors.textMuted },
  castName: { ...type.caption, color: colors.text, marginTop: spacing.sm, textAlign: 'center' },
  castCharacter: { ...type.caption, color: colors.textFaint, fontSize: 11, textAlign: 'center' },

  recRow: { gap: spacing.md },
  recCard: { width: 110 },
  recPoster: { width: 110, height: 165, borderRadius: radii.sm, backgroundColor: colors.purple },
  recLoading: {
    top: 0,
    left: 0,
    right: 0,
    height: 165,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13,4,24,0.55)',
    borderRadius: radii.sm,
  },
  recTitle: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },
});
