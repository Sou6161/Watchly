import { useEffect } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Button } from './ui';
import { colors, radii, spacing, type } from '../theme';

/**
 * A shimmering placeholder block.
 *
 * Warm, not grey: a cold #eee skeleton on a deep-purple gradient looks like a
 * rendering bug. This pulses between two tints of the surface colour, so a
 * loading screen still reads as Watchly.
 */
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1, // forever
      true, // reverse — a breathing pulse, not a sawtooth restart
    );
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[s.skeleton, style, animated]} />;
}

/** The shape of a history row, while the history is loading. */
export function HistoryRowSkeleton() {
  return (
    <View style={s.rowSkeleton}>
      <Skeleton style={s.skelPoster} />
      <View style={s.skelBody}>
        <Skeleton style={s.skelLineWide} />
        <Skeleton style={s.skelLineNarrow} />
      </View>
    </View>
  );
}

/** The shape of a match card, while results load. */
export function MatchCardSkeleton() {
  return (
    <View style={s.matchSkeleton}>
      <View style={s.matchSkelTop}>
        <Skeleton style={s.skelBigPoster} />
        <View style={s.skelBody}>
          <Skeleton style={s.skelLineWide} />
          <Skeleton style={s.skelLineNarrow} />
        </View>
      </View>
      <Skeleton style={s.skelButton} />
    </View>
  );
}

/**
 * Something went wrong and the user can do something about it.
 *
 * Every error the user actually sees should offer a way forward — a dead end
 * with an apology is worse than no message at all.
 */
export function ErrorState({
  title = 'That didn’t work.',
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={s.state}>
      <Text style={s.stateTitle}>{title}</Text>
      <Text style={s.stateBody}>{message}</Text>
      {onRetry && (
        <View style={s.stateAction}>
          <Button label={retryLabel} onPress={onRetry} />
        </View>
      )}
    </Animated.View>
  );
}

/** Nothing here yet — and that's fine. Empty states get personality, not apologies. */
export function EmptyState({
  emoji,
  title,
  message,
  actionLabel,
  onAction,
}: {
  emoji: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={s.state}>
      <Text style={s.stateEmoji}>{emoji}</Text>
      <Text style={s.stateTitle}>{title}</Text>
      <Text style={s.stateBody}>{message}</Text>
      {actionLabel && onAction && (
        <View style={s.stateAction}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  skeleton: { backgroundColor: colors.surface, borderRadius: radii.sm },

  rowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  skelPoster: { width: 36, height: 54, borderRadius: 4 },
  skelBigPoster: { width: 84, height: 126, borderRadius: radii.sm },
  skelBody: { flex: 1, gap: spacing.sm },
  skelLineWide: { height: 14, width: '80%' },
  skelLineNarrow: { height: 10, width: '45%' },
  skelButton: { height: 44, borderRadius: radii.pill, marginTop: spacing.md },

  matchSkeleton: {
    backgroundColor: '#241640',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  matchSkelTop: { flexDirection: 'row', gap: spacing.md },

  state: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  stateEmoji: { fontSize: 44, marginBottom: spacing.md },
  stateTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  stateBody: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  stateAction: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
