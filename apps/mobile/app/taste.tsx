import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Heading, Screen } from '../src/components/ui';
import { EmptyState, ErrorState } from '../src/components/states';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import type { TasteProfile } from '../src/lib/types';
import { colors, radii, spacing, type } from '../src/theme';

export default function Taste() {
  const router = useRouter();
  const user = useUser();
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<TasteProfile>('/api/me/taste');
        if (!cancelled) {
          setProfile(res);
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

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Your taste</Heading>

        {failed ? (
          <View style={s.pad}>
            <ErrorState
              title="Couldn’t load your taste."
              message="Your nights are safe — this is just the connection."
              onRetry={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            />
          </View>
        ) : !profile ? (
          <Text style={s.loading}>Reading the room…</Text>
        ) : profile.nights === 0 ? (
          <View style={s.pad}>
            <EmptyState
              emoji="🎭"
              title="No taste yet."
              message="Play a few nights and this fills in — the genres you love and how in sync you two really are."
            />
          </View>
        ) : (
          <Profile profile={profile} name={user?.displayName ?? 'you'} />
        )}
      </ScrollView>
    </Screen>
  );
}

function Profile({ profile, name }: { profile: TasteProfile; name: string }) {
  const router = useRouter();
  const agreementPct = profile.agreement === null ? null : Math.round(profile.agreement * 100);
  const yesPct = Math.round(profile.yesRate * 100);

  return (
    <View style={s.body}>
      {/* The headline — the one number that says whether your taste actually
          matches. Softened to a warm frame, never a cold percentage grade. */}
      <Animated.View entering={FadeInDown.duration(420)} style={s.hero}>
        {agreementPct === null ? (
          <>
            <Text style={s.heroBig}>—</Text>
            <Text style={s.heroCaption}>Not enough yeses yet to tell.</Text>
          </>
        ) : (
          <>
            <Text style={s.heroBig}>{agreementPct}%</Text>
            <Text style={s.heroCaption}>{agreementBlurb(agreementPct)}</Text>
          </>
        )}
      </Animated.View>

      {/* Weekly rhythm — the returning ritual. A live streak is a reason to come
          back this week; a broken one is a gentle nudge, never a scold. */}
      {(profile.streakWeeks > 0 || profile.thisWeek > 0) && (
        <Animated.View entering={FadeInDown.duration(400)} style={s.recap}>
          <Text style={s.recapFlame}>{profile.streakWeeks > 0 ? '🔥' : '🎬'}</Text>
          <View style={s.recapBody}>
            <Text style={s.recapTitle}>
              {profile.streakWeeks > 1
                ? `${profile.streakWeeks}-week streak`
                : profile.streakWeeks === 1
                  ? 'On a roll this week'
                  : 'Pick up where you left off'}
            </Text>
            <Text style={s.recapSub}>
              {profile.thisWeek > 0
                ? `${profile.thisWeek} night${profile.thisWeek === 1 ? '' : 's'} in the last 7 days`
                : 'A night this week keeps the streak alive'}
            </Text>
          </View>
        </Animated.View>
      )}

      <View style={s.stats}>
        <Stat value={String(profile.nights)} label={profile.nights === 1 ? 'night' : 'nights'} />
        <Stat value={String(profile.watchedTogether)} label="watched together" />
        <Stat value={`${yesPct}%`} label={`${name}'s yes rate`} />
      </View>

      {/* The loop, closed: the last thing you actually watched. Gives the
          "watched together" number a face. */}
      {profile.lastWatched && (
        <Animated.View entering={FadeInDown.delay(80).duration(420)} style={s.lastWatched}>
          {profile.lastWatched.posterUrl ? (
            <Image
              source={{ uri: profile.lastWatched.posterUrl }}
              style={s.lwPoster}
              resizeMode="cover"
            />
          ) : (
            <View style={[s.lwPoster, s.lwPosterEmpty]} />
          )}
          <View style={s.lwBody}>
            <Text style={s.lwEyebrow}>Last watched together</Text>
            <Text style={s.lwTitle} numberOfLines={3}>
              {profile.lastWatched.title}
            </Text>
          </View>
        </Animated.View>
      )}

      {profile.seen > 0 && (
        <Text style={s.seenLine}>
          You&apos;ve already seen {profile.seen} of the {profile.swiped} you swiped — a well-watched
          pair.
        </Text>
      )}

      {profile.loves.length > 0 && (
        <Animated.View entering={FadeInDown.delay(120).duration(420)}>
          <Text style={s.sectionLabel}>You gravitate to</Text>
          <View style={s.genres}>
            {profile.loves.map((g, i) => (
              <View key={g.genre} style={[s.genre, i === 0 && s.genreTop]}>
                <Text style={[s.genreText, i === 0 && s.genreTextTop]}>{g.genre}</Text>
                <Text style={[s.genreCount, i === 0 && s.genreTextTop]}>{g.count}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      {/* Only offer the share card once there's a real number to show off. */}
      {agreementPct !== null && (
        <Button
          label="📸  Share our sync"
          variant="ghost"
          onPress={() => router.push('/share-taste')}
        />
      )}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** Warm, never clinical — a low score should read as "opposites attract", not a failing grade. */
function agreementBlurb(pct: number): string {
  if (pct >= 66) return 'You two are dangerously in sync.';
  if (pct >= 40) return 'A healthy amount of overlap.';
  if (pct >= 20) return 'Opposites, mostly, that’s what negotiation is for.';
  return 'Wildly different taste. Somehow it works.';
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xl },
  loading: { ...type.body, color: colors.textMuted, marginTop: spacing.xl },
  pad: { marginTop: spacing.xl },

  body: { marginTop: spacing.lg, gap: spacing.xl },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  heroBig: { ...type.hero, fontSize: 64, lineHeight: 68, color: colors.gold },
  heroCaption: { ...type.body, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.lg },

  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recapFlame: { fontSize: 28 },
  recapBody: { flex: 1, minWidth: 0 },
  recapTitle: { ...type.label, color: colors.text },
  recapSub: { ...type.caption, color: colors.textFaint, marginTop: 2 },

  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  statValue: { ...type.title, fontSize: 24, color: colors.text },
  statLabel: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs, textAlign: 'center' },

  lastWatched: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  lwPoster: { width: 60, height: 90, borderRadius: radii.sm, backgroundColor: colors.purple },
  lwPosterEmpty: { opacity: 0.5 },
  lwBody: { flex: 1, minWidth: 0 },
  lwEyebrow: {
    ...type.caption,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  lwTitle: { ...type.title, fontSize: 18, lineHeight: 23, color: colors.text },

  seenLine: { ...type.body, color: colors.textMuted },

  sectionLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.md },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genre: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreTop: { backgroundColor: colors.red, borderColor: colors.red },
  genreText: { ...type.label, color: colors.text },
  genreTextTop: { color: '#fff' },
  genreCount: { ...type.caption, color: colors.textFaint },
});
