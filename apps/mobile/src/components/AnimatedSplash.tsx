import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { bgGradient, colors, spacing, type } from '../theme';

const MARK = 132; // play-mark canvas size
const GLOW = 300; // red bloom diameter

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const glow = useSharedValue(0);
  const mark = useSharedValue(0);
  const word = useSharedValue(0);
  const rule = useSharedValue(0);
  const tag = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    const easeOut = Easing.out(Easing.cubic);

    // The bloom leads, so the mark lands into light.
    glow.value = withTiming(1, { duration: 760, easing: easeOut });
    // Spring gives the mark a crafted, physical arrival rather than a linear pop.
    mark.value = withSpring(1, { damping: 11, stiffness: 130, mass: 0.9 });
    // Wordmark rises out from behind its own baseline.
    word.value = withDelay(320, withTiming(1, { duration: 560, easing: easeOut }));
    rule.value = withDelay(620, withTiming(1, { duration: 480, easing: easeOut }));
    tag.value = withDelay(820, withTiming(1, { duration: 460, easing: easeOut }));

    // Hold a beat on the finished lockup, then dissolve into the app.
    fade.value = withDelay(
      1780,
      withTiming(0, { duration: 460, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(onFinish)();
      }),
    );
  }, [glow, mark, word, rule, tag, fade]);

  const container = useAnimatedStyle(() => ({ opacity: fade.value }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.9 * glow.value,
    transform: [{ scale: 0.6 + 0.55 * glow.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.value,
    transform: [
      { scale: 0.72 + 0.28 * mark.value },
      { rotate: `${-7 * (1 - mark.value)}deg` },
    ],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: 34 * (1 - word.value) }],
  }));
  const ruleStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ scaleX: rule.value }] }));
  const tagStyle = useAnimatedStyle(() => ({
    opacity: tag.value,
    transform: [{ translateY: 8 * (1 - tag.value) }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.root, container]} pointerEvents="none">
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFill} />

      {/* Cinematic vignette — pulls the eye to centre, fitting for a film app. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="vignette" cx="50%" cy="46%" r="75%">
            <Stop offset="55%" stopColor="#000000" stopOpacity="0" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vignette)" />
      </Svg>

      <View style={s.center}>
        {/*
          The glow and the mark are locked to ONE fixed-size box and centered
          against THAT box, not against the wider column of siblings below. An
          absolutely-positioned glow with no top/left was left to Yoga's default
          placement, which isn't guaranteed to land on the same centre as the
          mark once there's a multi-line stack of siblings underneath it — that
          was the "glow sits a little low" bug. absoluteFillObject pins it to
          exactly the badge's box, so both layers share one centre, always.
        */}
        <View style={s.badge}>
          <Animated.View style={[StyleSheet.absoluteFillObject, s.glowFill, glowStyle]} pointerEvents="none">
            <Svg width={GLOW} height={GLOW}>
              <Defs>
                <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={colors.red} stopOpacity="0.55" />
                  <Stop offset="55%" stopColor={colors.red} stopOpacity="0.14" />
                  <Stop offset="100%" stopColor={colors.red} stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width={GLOW} height={GLOW} fill="url(#bloom)" />
            </Svg>
          </Animated.View>

          {/* The play mark, drawn as vector so it stays crisp at any density. */}
          <Animated.View style={markStyle}>
            <Svg width={MARK} height={MARK} viewBox="0 0 100 100">
              <Defs>
                <SvgLinearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor="#F7DC5C" />
                  <Stop offset="100%" stopColor="#E7BE34" />
                </SvgLinearGradient>
              </Defs>
              <Polygon
                points="39,25 82,50 39,75"
                fill="url(#gold)"
                stroke="url(#gold)"
                strokeWidth={14}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
        </View>

        {/* Wordmark rises out from behind its baseline (overflow clips the slide). */}
        <View style={s.wordMask}>
          <Animated.Text style={[s.wordmark, wordStyle]}>Watchly</Animated.Text>
        </View>
        <Animated.View style={[s.rule, ruleStyle]} />
        <Animated.Text style={[s.tagline, tagStyle]}>Two people, one decision.</Animated.Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgBottom },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { width: GLOW, height: GLOW, alignItems: 'center', justifyContent: 'center' },
  glowFill: { alignItems: 'center', justifyContent: 'center' },

  // paddingBottom keeps the descender on the "y" from being clipped by overflow.
  wordMask: {
    overflow: 'hidden',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.sm,
    paddingBottom: 8,
  },
  wordmark: { ...type.hero, fontSize: 46, lineHeight: 58, color: colors.text, letterSpacing: 1 },
  rule: {
    width: 54,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.gold,
    marginTop: spacing.md,
    opacity: 0.9,
  },
  tagline: { ...type.body, color: colors.textMuted, marginTop: spacing.md, letterSpacing: 0.3 },
});
