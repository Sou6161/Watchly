import { useEffect, useState } from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { Decision } from '@watchly/shared';
import type { PublicTitle } from '../lib/types';
import { track } from '../lib/analytics';
import { TrailerModal } from './TrailerModal';
import { colors, radii, spacing, type } from '../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Spelled out rather than using StyleSheet.absoluteFillObject, whose typing has
 *  come and gone across RN versions. */
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const CARD_W = SCREEN_W - spacing.lg * 2;
const CARD_H = SCREEN_H * 0.68;

/** How far a card must travel before release commits the swipe. */
const SWIPE_THRESHOLD = SCREEN_W * 0.28;
/** ...or how fast it must be moving. A quick flick shouldn't need the distance. */
const VELOCITY_THRESHOLD = 700;

/** Spring config tuned for a card with weight — settles fast, no wobble. */
const SPRING = { damping: 18, stiffness: 180, mass: 0.9 } as const;

/** Resting scale/offset of the card behind the top one — what makes it a deck. */
const BACK_SCALE = 0.93;
const BACK_OFFSET_Y = 14;

interface Props {
  title: PublicTitle;
  onDecide: (decision: Decision) => void;
  isTop: boolean;
  /**
   * 0..1 — how far the TOP card has been dragged toward a decision.
   *
   * Written by the top card, read by the one underneath so it rises to meet the
   * user as the top card leaves. Shared rather than local state because it updates
   * every frame on the UI thread; routing it through React would drop frames in
   * the one interaction that cannot afford to.
   */
  deckProgress: SharedValue<number>;
}

export function SwipeCard({ title, onDecide, isTop, deckProgress }: Props) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gone = useSharedValue(false);
  /** Latches so the threshold tick fires once per crossing, not every frame. */
  const armed = useSharedValue(false);

  /**
   * Tap to play. The poster is the resting state and stays untouched until the
   * user asks for the trailer, so the card reads as art first.
   *
   * (This overrides the "trailers autoplay with sound, no tap-to-play" rule in
   * the original spec — autoplay was a deliberate product decision that got
   * reversed after seeing it on device, where the snap from poster to video felt
   * jumpy. Deliberate reversal, not an oversight.)
   */
  const [trailerOpen, setTrailerOpen] = useState(false);

  // Close the trailer if this card stops being the top one — a modal belonging to
  // a card that has already been swiped away would be stranded on screen.
  useEffect(() => {
    if (!isTop) setTrailerOpen(false);
  }, [isTop]);

  const openTrailer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track.trailerPlayed();
    setTrailerOpen(true);
  };

  /** Light tap the instant the swipe crosses into committal territory. */
  const tick = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /**
   * Each decision gets its own feel, because they are not the same kind of act.
   *
   * YES is the one worth celebrating. NO is a rejection. But SEEN and MAYBE are
   * neither — they're neutral bookkeeping, and firing the system Warning pattern
   * at someone for "seen it" makes an ordinary action feel like a mistake. They
   * get a plain tap instead.
   */
  const commit = (decision: Decision) => {
    if (decision === 'YES') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (decision === 'NO') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onDecide(decision);
  };

  const fly = (decision: Decision, toX: number, toY: number) => {
    'worklet';
    gone.value = true;
    // The card behind is now the top card — snap it fully forward.
    deckProgress.value = withTiming(1, { duration: 220 });
    x.value = withTiming(toX, { duration: 220 });
    y.value = withTiming(toY, { duration: 220 }, () => {
      runOnJS(commit)(decision);
    });
  };

  const pan = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      if (gone.value) return;
      x.value = e.translationX;
      y.value = e.translationY;

      const travel = Math.max(Math.abs(e.translationX), Math.abs(e.translationY));

      // Feed the card underneath, so it rises as this one is pulled away.
      deckProgress.value = Math.min(travel / SWIPE_THRESHOLD, 1);

      /**
       * A tick at the moment the swipe becomes committal.
       *
       * Without it the threshold is invisible: you let go and find out afterwards
       * whether it counted. With it your thumb knows, which is most of what makes
       * a swipe feel confident rather than hopeful. Latched so it fires once per
       * crossing — firing every frame past the line would buzz continuously.
       */
      const past = travel > SWIPE_THRESHOLD;
      if (past && !armed.value) {
        armed.value = true;
        runOnJS(tick)();
      } else if (!past && armed.value) {
        armed.value = false;
      }
    })
    .onEnd((e) => {
      if (gone.value) return;

      const fastX = Math.abs(e.velocityX) > VELOCITY_THRESHOLD;
      const fastY = Math.abs(e.velocityY) > VELOCITY_THRESHOLD;

      // Horizontal wins ties: left/right are the two decisions people actually
      // make, and a sloppy diagonal should read as the one they meant.
      if (Math.abs(x.value) > SWIPE_THRESHOLD || fastX) {
        const right = x.value > 0 || e.velocityX > 0;
        fly(right ? 'YES' : 'NO', right ? SCREEN_W * 1.5 : -SCREEN_W * 1.5, y.value);
        return;
      }

      if (Math.abs(y.value) > SWIPE_THRESHOLD || fastY) {
        const down = y.value > 0 || e.velocityY > 0;
        fly(down ? 'MAYBE' : 'SEEN', x.value, down ? SCREEN_H : -SCREEN_H);
        return;
      }

      // Didn't clear the bar — spring home, and let the card underneath settle
      // back down with it.
      x.value = withSpring(0, SPRING);
      y.value = withSpring(0, SPRING);
      deckProgress.value = withSpring(0, SPRING);
      armed.value = false;
    });

  const tap = Gesture.Tap()
    .enabled(isTop)
    // A swipe starts as a finger-down too. maxDistance keeps a drag that wanders
    // a few pixels from registering as a tap and firing the trailer mid-swipe.
    .maxDistance(12)
    .onEnd((_e, success) => {
      if (success) runOnJS(openTrailer)();
    });

  // Exclusive, with pan first: if the finger moves, it's a swipe and the tap is
  // abandoned. Racing them would let a fast flick also toggle the trailer.
  const gesture = Gesture.Exclusive(pan, tap);

  /**
   * The card underneath. Sits smaller and lower, and rises to full size as the top
   * card is dragged away — so the deck reads as a stack with depth rather than a
   * single card that teleports to the next title.
   */
  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: BACK_SCALE + (1 - BACK_SCALE) * deckProgress.value },
      { translateY: BACK_OFFSET_Y * (1 - deckProgress.value) },
    ],
  }));

  const cardStyle = useAnimatedStyle(() => {
    // Tilt scales with horizontal travel, capped so it never looks unhinged.
    const rotate = interpolate(x.value, [-SCREEN_W, 0, SCREEN_W], [-14, 0, 14]);
    // Fade only near the very end of the throw, so the card stays legible while
    // the user is still deciding.
    const opacity = interpolate(
      Math.max(Math.abs(x.value), Math.abs(y.value)),
      [0, SCREEN_W * 0.7, SCREEN_W],
      [1, 1, 0],
      'clamp',
    );
    return {
      transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${rotate}deg` }],
      opacity,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[s.card, isTop ? cardStyle : backStyle]}>
        {/* The poster IS the card. The trailer used to try to play behind it,
            which could never work — see TrailerModal for why. Tapping opens a real
            player instead. */}
        {title.posterUrl ? (
          <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
        ) : (
          <View style={[s.poster, s.posterEmpty]} />
        )}

        {/* The poster: base layer, fallback, and cover. Fades out once the trailer
            is genuinely playing, rather than the trailer fading in. */}
          {title.posterUrl ? (
            <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
          ) : (
            <View style={[s.poster, s.posterEmpty]} />
          )}

        {/* Scrim: keeps the metadata legible over any poster or trailer frame. */}
        <LinearGradient
          colors={['transparent', 'rgba(13,4,24,0.55)', 'rgba(13,4,24,0.96)']}
          locations={[0.35, 0.65, 1]}
          style={s.scrim}
          pointerEvents="none"
        />

        {/* Without an affordance, tap-to-play is invisible — nobody taps a poster
            on spec. */}
        {isTop && (
          <Animated.View
            entering={FadeIn.duration(300)}
            style={s.playHint}
            pointerEvents="none"
          >
            <View style={s.playCircle}>
              <View style={s.playGlyph} />
            </View>
            <Text style={s.playText}>Tap for trailer</Text>
          </Animated.View>
        )}

        <DecisionLabels x={x} y={y} />

        <View style={s.meta} pointerEvents="none">
          <Text style={s.title} numberOfLines={2}>
            {title.title}
          </Text>
          <Text style={s.facts}>{facts(title)}</Text>
          {/* No plot synopsis, by design — it would be a spoiler. */}
        </View>
        {isTop && (
          <TrailerModal
            visible={trailerOpen}
            videoIds={title.trailerYoutubeIds}
            title={title.title}
            onClose={() => setTrailerOpen(false)}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

/** Year · runtime · genres · rating. Everything except the plot. */
function facts(t: PublicTitle): string {
  const bits: string[] = [];
  if (t.releaseYear) bits.push(String(t.releaseYear));
  if (t.runtime) bits.push(t.type === 'TV' ? `${t.runtime}m eps` : `${t.runtime}m`);
  if (t.genres.length) bits.push(t.genres.slice(0, 2).join(', '));
  if (t.rating) bits.push(`★ ${t.rating.toFixed(1)}`);
  return bits.join('  ·  ');
}

/**
 * The four decision labels, each fading in as the card moves its way. Rendered
 * inside the card so they tilt with it.
 */
function DecisionLabels({ x, y }: { x: SharedValue<number>; y: SharedValue<number> }) {
  const at = (sv: SharedValue<number>, dir: 1 | -1, axis: SharedValue<number>) =>
    useAnimatedStyle(() => {
      // A label only shows while its own axis is the dominant one, so a diagonal
      // drag doesn't light up two contradictory verdicts at once.
      const dominant = Math.abs(sv.value) >= Math.abs(axis.value);
      const progress = interpolate(sv.value * dir, [20, SWIPE_THRESHOLD], [0, 1], 'clamp');
      return { opacity: dominant ? progress : 0 };
    });

  const yes = at(x, 1, y);
  const no = at(x, -1, y);
  const seen = at(y, -1, x);
  const maybe = at(y, 1, x);

  return (
    <>
      <Animated.View style={[s.label, s.labelYes, yes]} pointerEvents="none">
        <Text style={[s.labelText, { color: colors.gold }]}>YES</Text>
      </Animated.View>
      <Animated.View style={[s.label, s.labelNo, no]} pointerEvents="none">
        <Text style={[s.labelText, { color: colors.red }]}>NOPE</Text>
      </Animated.View>
      <Animated.View style={[s.label, s.labelSeen, seen]} pointerEvents="none">
        <Text style={[s.labelText, s.labelTextSmall]}>SEEN IT</Text>
      </Animated.View>
      <Animated.View style={[s.label, s.labelMaybe, maybe]} pointerEvents="none">
        <Text style={[s.labelText, s.labelTextSmall]}>MAYBE</Text>
      </Animated.View>
    </>
  );
}

const s = StyleSheet.create({
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.purple,
    shadowColor: colors.red,
    shadowOpacity: 0.15,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  poster: { ...FILL, width: CARD_W, height: CARD_H },
  posterEmpty: { backgroundColor: colors.purple },


  scrim: { ...FILL },

  playHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  playCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13,4,24,0.55)',
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  // A CSS-style triangle: a zero-width box with only the left border filled.
  playGlyph: {
    width: 0,
    height: 0,
    marginLeft: 6,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderLeftWidth: 20,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
  playText: { ...type.caption, color: colors.text },

  meta: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  title: { ...type.title, color: colors.text },
  facts: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },

  label: {
    position: 'absolute',
    borderWidth: 3,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(13,4,24,0.35)',
  },
  labelYes: { top: 40, left: 24, transform: [{ rotate: '-12deg' }], borderColor: colors.gold },
  labelNo: { top: 40, right: 24, transform: [{ rotate: '12deg' }], borderColor: colors.red },
  labelSeen: {
    top: 40,
    alignSelf: 'center',
    left: 0,
    right: 0,
    marginHorizontal: 'auto',
    borderColor: colors.text,
  },
  labelMaybe: {
    bottom: 140,
    alignSelf: 'center',
    left: 0,
    right: 0,
    marginHorizontal: 'auto',
    borderColor: colors.textMuted,
  },
  labelText: { ...type.button, fontSize: 28, letterSpacing: 2 },
  labelTextSmall: { fontSize: 18, color: colors.text, textAlign: 'center' },
});
