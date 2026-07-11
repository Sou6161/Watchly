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
import YoutubePlayer from 'react-native-youtube-iframe';
import type { Decision } from '@watchly/shared';
import type { PublicTitle } from '../lib/types';
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

/**
 * Video dimensions for a cover-crop. YouTube's iframe is immovably 16:9, so to
 * fill a portrait card we size it by HEIGHT and let the width overflow, then
 * centre it. Sizing by width instead would letterbox a 16:9 band across the top
 * with the poster visible below — which is exactly what it did before.
 */
const VIDEO_H = CARD_H;
const VIDEO_W = CARD_H * (16 / 9);
const VIDEO_OFFSET_X = (CARD_W - VIDEO_W) / 2; // negative: overflows both sides

interface Props {
  title: PublicTitle;
  onDecide: (decision: Decision) => void;
  /** The card underneath, which scales up as this one is dragged away. */
  isTop: boolean;
}

export function SwipeCard({ title, onDecide, isTop }: Props) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gone = useSharedValue(false);

  /**
   * Tap to play. The poster is the resting state and stays untouched until the
   * user asks for the trailer, so the card reads as art first.
   *
   * (This overrides the "trailers autoplay with sound, no tap-to-play" rule in
   * the original spec — autoplay was a deliberate product decision that got
   * reversed after seeing it on device, where the snap from poster to video felt
   * jumpy. Deliberate reversal, not an oversight.)
   */
  const [requested, setRequested] = useState(false);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [trailerReady, setTrailerReady] = useState(false);

  // Only the top card may play. When this card is buried by the next one — or
  // swiped away — the trailer stops dead, so no audio bleeds between cards.
  const playing = requested && isTop && !trailerFailed;

  useEffect(() => {
    if (!isTop) {
      setRequested(false);
      setTrailerReady(false);
    }
  }, [isTop]);

  const toggleTrailer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRequested((prev) => !prev);
  };

  /**
   * The trailer fades in only once the player reports ready. Until then the card
   * shows the poster alone — never the poster with a half-loaded YouTube frame
   * and its "Watch on YouTube" chrome sitting on top of it.
   */
  const videoOpacity = useSharedValue(0);

  useEffect(() => {
    videoOpacity.value = withTiming(trailerReady && playing ? 1 : 0, { duration: 420 });
  }, [trailerReady, playing, videoOpacity]);

  const videoStyle = useAnimatedStyle(() => ({ opacity: videoOpacity.value }));

  const commit = (decision: Decision) => {
    Haptics.notificationAsync(
      decision === 'YES'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
    onDecide(decision);
  };

  const fly = (decision: Decision, toX: number, toY: number) => {
    'worklet';
    gone.value = true;
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

      // Didn't clear the bar — spring home.
      x.value = withSpring(0, SPRING);
      y.value = withSpring(0, SPRING);
    });

  const tap = Gesture.Tap()
    .enabled(isTop)
    // A swipe starts as a finger-down too. maxDistance keeps a drag that wanders
    // a few pixels from registering as a tap and firing the trailer mid-swipe.
    .maxDistance(12)
    .onEnd((_e, success) => {
      if (success) runOnJS(toggleTrailer)();
    });

  // Exclusive, with pan first: if the finger moves, it's a swipe and the tap is
  // abandoned. Racing them would let a fast flick also toggle the trailer.
  const gesture = Gesture.Exclusive(pan, tap);

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
      <Animated.View style={[s.card, cardStyle]}>
        {/* Poster is the base layer and the fallback: it must be visible before
            the trailer loads, and stay visible if the trailer never does. */}
        {title.posterUrl ? (
          <Image source={{ uri: title.posterUrl }} style={s.poster} resizeMode="cover" />
        ) : (
          <View style={[s.poster, s.posterEmpty]} />
        )}

        {/* Mounted only once the trailer is actually asked for. Mounting it on the
            top card regardless would have the WebView fetch and buffer YouTube in
            the background behind a transparent layer — wasted data on a deck of
            fifteen cards the user may never tap. */}
        {isTop && requested && !trailerFailed && (
          // Cropped to COVER the card. The iframe is locked to 16:9, so sizing it
          // to the card's width would fill only a band across the top and let the
          // poster show through underneath. Instead we make it tall enough to fill
          // the card, let it overflow the sides, and centre it — the card's
          // overflow:hidden does the cropping.
          <Animated.View
            style={[s.video, videoStyle]}
            pointerEvents="none"
            needsOffscreenAlphaCompositing
          >
            <YoutubePlayer
              height={VIDEO_H}
              width={VIDEO_W}
              play={playing}
              videoId={title.trailerYoutubeId}
              // Spec: trailers autoplay WITH sound. Two people on a couch want to
              // hear it. 50% so it's present without being a jump-scare.
              volume={50}
              initialPlayerParams={{
                controls: false,
                modestbranding: true,
                rel: false,
                // Without this the video goes fullscreen on Android instead of
                // playing inside the card.
                playsinline: true,
              }}
              onReady={() => setTrailerReady(true)}
              onError={() => setTrailerFailed(true)}
              onChangeState={(state: string) => {
                // 'unstarted' after a play attempt means the platform blocked
                // autoplay. Rather than sit on YouTube's branded thumbnail, drop
                // back to the poster — it looks deliberate instead of broken.
                if (state === 'ended') setTrailerReady(false);
              }}
              webViewProps={{
                androidLayerType: 'hardware',
                // The reason autoplay was silently failing: Android's WebView
                // refuses to start media without a user gesture unless told
                // otherwise, so `play` had no effect and YouTube showed its
                // thumbnail + play button instead.
                mediaPlaybackRequiresUserAction: false,
                allowsInlineMediaPlayback: true,
                allowsFullscreenVideo: false,
                scrollEnabled: false,
              }}
              webViewStyle={s.webView}
            />
          </Animated.View>
        )}

        {/* Scrim: keeps the metadata legible over any poster or trailer frame. */}
        <LinearGradient
          colors={['transparent', 'rgba(13,4,24,0.55)', 'rgba(13,4,24,0.96)']}
          locations={[0.35, 0.65, 1]}
          style={s.scrim}
          pointerEvents="none"
        />

        {/* Without an affordance, tap-to-play is invisible — nobody taps a poster
            on spec. Hidden once the trailer is actually up. */}
        {isTop && !playing && !trailerFailed && (
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

  // Overflows the card horizontally so the 16:9 video covers the portrait card;
  // the card's overflow:hidden crops the excess.
  video: {
    position: 'absolute',
    top: 0,
    left: VIDEO_OFFSET_X,
    width: VIDEO_W,
    height: VIDEO_H,
  },
  // The WebView paints white before the player renders, which flashes through
  // the fade. Transparent keeps the poster showing underneath instead.
  webView: { backgroundColor: 'transparent', opacity: 0.999 },

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
