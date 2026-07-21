import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOutUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import type { PublicTitle, WatchCheck } from '../lib/types';
import { colors, radii, spacing, type } from '../theme';

/**
 * The morning-after prompt. Closing the loop is the whole point: a swipe says what
 * two people *wanted*, but "we actually watched this" is the only signal that the
 * app did its job — and it's far stronger evidence for the taste profile than any
 * number of yeses. One tap to answer, then it's gone for good.
 */
export function WatchCheckCard({
  check,
  onAnswered,
}: {
  check: WatchCheck;
  onAnswered: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const answer = async (watchedTitleId: string | null) => {
    if (submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track.watchLogged({ watched: watchedTitleId !== null });
    try {
      await api(`/api/sessions/${check.session.id}/watched`, {
        method: 'POST',
        body: { watchedTitleId },
      });
    } catch {
      // Non-fatal: the prompt reappears next launch if this didn't land. Better a
      // second ask than a silently-lost answer.
    } finally {
      // Dismiss regardless — the session is optimistically answered, and re-asking
      // on failure is the acceptable failure mode.
      onAnswered();
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(400)} exiting={FadeOutUp.duration(240)} style={s.card}>
      <Text style={s.eyebrow}>Last night with {check.partnerLabel}</Text>
      <Text style={s.title}>Did you watch one of your matches?</Text>

      <View style={s.options}>
        {check.matches.slice(0, 3).map((t) => (
          <WatchOption key={t.id} title={t} onPress={() => answer(t.id)} disabled={submitting} />
        ))}
      </View>

      <Pressable
        onPress={() => answer(null)}
        disabled={submitting}
        hitSlop={8}
        style={({ pressed }) => [s.dismiss, pressed && s.pressed]}
      >
        <Text style={s.dismissText}>We didn&apos;t get to it</Text>
      </Pressable>
    </Animated.View>
  );
}

function WatchOption({
  title,
  onPress,
  disabled,
}: {
  title: PublicTitle;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [s.option, pressed && s.pressed]}
    >
      {title.posterUrl ? (
        <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
      ) : (
        <View style={[s.poster, s.posterEmpty]} />
      )}
      <Text style={s.optionTitle} numberOfLines={2}>
        {title.title}
      </Text>
      <Text style={s.check}>✓</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.gold,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  eyebrow: {
    ...type.caption,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  title: { ...type.label, color: colors.text },

  options: { gap: spacing.sm, marginTop: spacing.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  poster: { width: 32, height: 48, borderRadius: 4, backgroundColor: colors.purple },
  posterEmpty: { opacity: 0.5 },
  optionTitle: { ...type.label, color: colors.text, flex: 1, minWidth: 0 },
  check: { ...type.title, color: colors.gold },

  dismiss: { alignSelf: 'center', paddingVertical: spacing.sm },
  dismissText: { ...type.caption, color: colors.textFaint },
  pressed: { opacity: 0.7 },
});
