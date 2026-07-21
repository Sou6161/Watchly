import { useEffect } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { Decision } from '@watchly/shared';
import { SwipeCard } from '../../src/components/SwipeCard';
import { Button, Screen } from '../../src/components/ui';
import { startPersonB, useSessionStore } from '../../src/stores/session';
import { colors, spacing, type } from '../../src/theme';

export default function Swipe() {
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const titles = useSessionStore((s) => s.titles);
  const index = useSessionStore((s) => s.index);
  const phase = useSessionStore((s) => s.phase);
  const vote = useSessionStore((s) => s.vote);
  const voter = useSessionStore((s) => s.voter);
  const abandoned = useSessionStore((s) => s.abandoned);
  const reset = useSessionStore((s) => s.reset);

  /**
   * Drag progress of the top card, 0..1. Owned here rather than in the card so it
   * survives the card being unmounted mid-throw, and so the card underneath can
   * read the card above's gesture.
   */
  const deckProgress = useSharedValue(0);

  // A new card is on top now — put the deck back to its resting depth. Without
  // this the incoming back card would start already scaled up, and the stack
  // would visibly flatten after the first swipe.
  useEffect(() => {
    deckProgress.value = 0;
  }, [index, deckProgress]);

  // Reloading straight onto this route (or after a reset) leaves no deck to swipe.
  useEffect(() => {
    if (!session) router.replace('/home');
  }, [session, router]);

  useEffect(() => {
    if (phase === 'DONE') router.replace('/session/results');
  }, [phase, router]);

  // Async: person A finished their deck. Hand off to the share screen with the
  // code so person B can pick it up whenever.
  useEffect(() => {
    if (phase === 'ASYNC_DONE' && session) {
      const partner = voter === 'PERSON_B' ? session.personALabel : session.personBLabel;
      router.replace(
        `/session/share?code=${session.code}&partner=${encodeURIComponent(partner)}`,
      );
    }
  }, [phase, session, voter, router]);

  // The server gave up on this session (30 minutes idle). Say so plainly rather
  // than letting them keep swiping into votes that will be rejected.
  useEffect(() => {
    if (!abandoned) return;
    Alert.alert('Session timed out', 'Nobody swiped for a while, so we closed it.', [
      {
        text: 'OK',
        onPress: () => {
          reset();
          router.replace('/home');
        },
      },
    ]);
  }, [abandoned, reset, router]);

  if (!session) return null;

  if (phase === 'HANDOFF') {
    return <Handoff name={session.personBLabel} onReady={startPersonB} />;
  }

  if (phase === 'WAITING_FOR_PARTNER') {
    return <WaitingForPartner />;
  }

  const current = titles[index];
  const next = titles[index + 1];

  const multi = session.mode === 'MULTI_DEVICE';
  const swiper = multi
    ? voter === 'PERSON_B'
      ? session.personBLabel
      : session.personALabel
    : phase === 'PERSON_B'
      ? session.personBLabel
      : session.personALabel;

  const onDecide = (decision: Decision) => {
    vote(decision);
  };

  return (
    <Screen>
      <View style={s.header}>
        <Text style={s.swiper}>{swiper}&apos;s turn</Text>
        <Text style={s.count}>
          {Math.min(index + 1, titles.length)} / {titles.length}
        </Text>
      </View>

      <View style={s.deck}>
        {/* The next card sits underneath so the deck never looks empty mid-throw.
            Keyed by id so React tears down the old card's WebView on advance. */}
        {next && (
          <SwipeCard
            key={next.id}
            title={next}
            onDecide={() => {}}
            isTop={false}
            deckProgress={deckProgress}
          />
        )}
        {current && (
          <SwipeCard
            key={current.id}
            title={current}
            onDecide={onDecide}
            isTop
            deckProgress={deckProgress}
          />
        )}
      </View>

      <View style={s.legend}>
        <Text style={s.legendText}>← nope · yes → </Text>
        <Text style={s.legendText}>↑ seen it · maybe ↓</Text>
      </View>
    </Screen>
  );
}

/**
 * Multi-device: you've finished your fifteen, they haven't. The server decides
 * when the session is over (it emits session:completed once both are done), so
 * this screen just waits — there is nothing for the client to poll or decide.
 */
function WaitingForPartner() {
  const session = useSessionStore((s) => s.session);
  const progress = useSessionStore((s) => s.progress);
  const partnerConnected = useSessionStore((s) => s.partnerConnected);
  const voter = useSessionStore((s) => s.voter);

  if (!session) return null;

  const them = voter === 'PERSON_A' ? session.personBLabel : session.personALabel;

  // Their count, not ours. Never their decisions — those stay sealed until results.
  const theirCount = voter === 'PERSON_A' ? progress?.personB : progress?.personA;
  const total = progress?.total ?? session.queueLength;

  return (
    <Screen>
      <Animated.View entering={FadeIn.duration(400)} style={s.waiting}>
        <Text style={s.waitingEyebrow}>Done.</Text>
        <Text style={s.waitingTitle}>Now we wait on {them}.</Text>
        <Text style={s.waitingCopy}>
          {partnerConnected
            ? "No peeking. You'll both see the matches at the same moment."
            : `${them} dropped off. Their swipes are saved — this picks up the moment they're back.`}
        </Text>

        {theirCount !== undefined && (
          <View style={s.progressWrap}>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${(theirCount / total) * 100}%` }]} />
            </View>
            <Text style={s.progressText}>
              {them} is on {Math.min(theirCount + 1, total)} of {total}
            </Text>
          </View>
        )}

        <ActivityIndicator color={colors.red} style={s.waitingSpinner} />
      </Animated.View>
    </Screen>
  );
}

/**
 * The phone-passing moment. The spec is explicit that this is a *moment*, not a
 * screen change — so it gets a held beat, a haptic thump, and a name, and it
 * refuses to advance until the new person actually taps.
 */
function Handoff({ name, onReady }: { name: string; onReady: () => void }) {
  const scale = useSharedValue(0.9);
  const lift = useSharedValue(20);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scale.value = withSequence(
      withSpring(1.04, { damping: 12, stiffness: 140 }),
      withSpring(1, { damping: 14, stiffness: 160 }),
    );
    lift.value = withDelay(80, withTiming(0, { duration: 420 }));
  }, [scale, lift]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: lift.value }],
  }));

  return (
    <Screen>
      <Animated.View
        entering={FadeIn.duration(400)}
        exiting={FadeOut.duration(200)}
        style={s.handoff}
      >
        <Animated.View style={style}>
          <Text style={s.handoffEyebrow}>Pass the phone</Text>
          <Text style={s.handoffName}>{name}</Text>
          <Text style={s.handoffCopy}>
            Same fifteen. No peeking at what they picked — that&apos;s the whole point.
          </Text>
        </Animated.View>

        <View style={s.handoffAction}>
          <Button label={`I'm ready`} onPress={onReady} />
        </View>
      </Animated.View>
    </Screen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  swiper: { ...type.label, color: colors.text },
  count: { ...type.caption, color: colors.textFaint },

  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  legend: { alignItems: 'center', paddingBottom: spacing.md, gap: spacing.xs },
  legendText: { ...type.caption, color: colors.textFaint },

  waiting: { flex: 1, justifyContent: 'center' },
  waitingEyebrow: { ...type.label, color: colors.gold, letterSpacing: 2, textTransform: 'uppercase' },
  waitingTitle: { ...type.hero, color: colors.text, marginTop: spacing.sm },
  waitingCopy: { ...type.body, color: colors.textMuted, marginTop: spacing.md },
  waitingSpinner: { marginTop: spacing.xl },
  progressWrap: { marginTop: spacing.xl, gap: spacing.sm },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.red },
  progressText: { ...type.caption, color: colors.textFaint },

  handoff: { flex: 1, justifyContent: 'center' },
  handoffEyebrow: { ...type.label, color: colors.red, letterSpacing: 2, textTransform: 'uppercase' },
  handoffName: { ...type.hero, color: colors.text, marginTop: spacing.sm },
  handoffCopy: { ...type.body, color: colors.textMuted, marginTop: spacing.md },
  handoffAction: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl },
});
