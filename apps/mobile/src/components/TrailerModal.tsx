import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import YoutubePlayer from 'react-native-youtube-iframe';
import { colors, radii, spacing, type } from '../theme';

/**
 * The trailer, in a proper player.
 *
 * WHY A MODAL AND NOT IN THE CARD
 *
 * The card version could never work, for three compounding reasons:
 *
 *  1. YouTube's iframe decides whether autoplay is allowed from the USER AGENT.
 *     On mobile it refuses, whatever the WebView permits.
 *  2. The in-card player had `controls: false` and sat under `pointerEvents:none`
 *     so the swipe gesture would keep working — which meant that when autoplay was
 *     refused there was no play button AND no way to touch the player. Playback was
 *     literally impossible.
 *  3. A WebView that accepts touches inside a pan gesture fights the swipe anyway.
 *
 * A modal dissolves all three. The player gets real controls, the user's tap is a
 * genuine gesture (which YouTube always honours), and the deck's gestures are
 * untouched because the card isn't involved.
 *
 * Some trailers still refuse to embed anywhere — `embed_not_allowed`. Nothing can
 * play those in-app, so we offer the YouTube app instead of a blank rectangle.
 *
 * ROTATION
 *
 * app.json locks the whole app to portrait — necessary everywhere else, wrong
 * here. While this modal is open we unlock the orientation so the OS will
 * actually rotate when the phone is turned, and re-lock to portrait the moment
 * it closes. Turning the phone sideways swaps the player to fill the screen
 * edge-to-edge instead of relying on YouTube's own (fiddly, WebView-fullscreen)
 * expand button.
 */
interface Props {
  visible: boolean;
  videoIds: string[];
  title: string;
  onClose: () => void;
}

export function TrailerModal({ visible, videoIds, title, onClose }: Props) {
  const [pickIndex, setPickIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const videoId = videoIds[pickIndex];

  // A new trailer deserves a clean slate — otherwise one blocked video would leave
  // the fallback showing for the next one.
  useEffect(() => {
    if (visible) {
      setPickIndex(0);
      setReady(false);
      setBlocked(false);
    }
  }, [visible]);

  useEffect(() => {
    setReady(false);
    setBlocked(false);
  }, [pickIndex]);

  // Unlock rotation only while the trailer is on screen — the rest of the app
  // (including the card behind it) stays portrait-only.
  useEffect(() => {
    if (!visible) return;
    ScreenOrientation.unlockAsync();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [visible]);

  const openInYouTube = () => {
    // The app if it's installed, the website if not.
    Linking.openURL(`vnd.youtube://${videoId}`).catch(() =>
      Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => {}),
    );
  };

  // Portrait: a fixed 16:9 box sized for a phone. Landscape: fill the width the
  // phone is now offering, capped by height so it never crops.
  const playerW = isLandscape ? Math.min(width, height * (16 / 9)) : PORTRAIT_W;
  const playerH = Math.round((playerW * 9) / 16);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.dismissArea} onPress={onClose} accessibilityLabel="Close trailer" />

        <View style={[s.stage, isLandscape && s.stageLandscape]}>
          {!isLandscape && (
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
          )}

          <View style={[s.player, { width: playerW, height: playerH }]}>
            {blocked ? (
              <View style={s.blocked}>
                <Text style={s.blockedTitle}>This trailer won&apos;t play here.</Text>
                <Text style={s.blockedBody}>
                  Its owner has disabled embedding — nothing can play it inside an app.
                </Text>
                <Pressable
                  onPress={openInYouTube}
                  style={({ pressed }) => [s.ytButton, pressed && s.pressed]}
                >
                  <Text style={s.ytButtonText}>Watch on YouTube</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {!ready && (
                  <View style={s.loading} pointerEvents="none">
                    <ActivityIndicator color={colors.red} />
                  </View>
                )}
                <YoutubePlayer
                  height={playerH}
                  width={playerW}
                  play={visible}
                  videoId={videoId}
                  /**
                   * Controls ON, deliberately. If YouTube declines to autoplay,
                   * the user needs a play button — the version without one was
                   * unplayable whenever autoplay was refused.
                   */
                  initialPlayerParams={{ controls: true, modestbranding: true, rel: false }}
                  // Desktop user agent on Android, which is what lets autoplay
                  // through at all. Harmless when the user taps play themselves.
                  forceAndroidAutoplay
                  onReady={() => setReady(true)}
                  onError={(e: string) => {
                    if (e === 'embed_not_allowed') setBlocked(true);
                    else setBlocked(true);
                  }}
                  webViewProps={{
                    mediaPlaybackRequiresUserAction: false,
                    allowsInlineMediaPlayback: true,
                    androidLayerType: 'none',
                  }}
                />
              </>
            )}
          </View>

          {!isLandscape && videoIds.length > 1 && (
            <View style={s.picker}>
              {videoIds.map((id, i) => (
                <Pressable
                  key={id}
                  onPress={() => setPickIndex(i)}
                  style={({ pressed }) => [
                    s.pickerChip,
                    i === pickIndex && s.pickerChipActive,
                    pressed && s.pressed,
                  ]}
                >
                  <Text
                    style={[s.pickerChipText, i === pickIndex && s.pickerChipTextActive]}
                  >
                    Trailer {i + 1}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {!isLandscape && (
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [s.close, pressed && s.pressed]}
              hitSlop={12}
            >
              <Text style={s.closeText}>Done</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

// 16:9, sized to sit comfortably on a phone in portrait.
const PORTRAIT_W = 340;

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(13,4,24,0.94)', justifyContent: 'center' },
  // Tapping anywhere off the player closes it.
  dismissArea: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  stage: { alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  stageLandscape: { paddingHorizontal: 0, gap: 0 },
  title: { ...type.label, color: colors.text, maxWidth: PORTRAIT_W },

  player: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  blocked: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  blockedTitle: { ...type.label, color: colors.text, textAlign: 'center' },
  blockedBody: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  ytButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: '#FF0000',
  },
  ytButtonText: { ...type.label, color: '#fff' },

  picker: { flexDirection: 'row', gap: spacing.sm },
  pickerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerChipActive: { backgroundColor: colors.red, borderColor: colors.red },
  pickerChipText: { ...type.caption, color: colors.textMuted },
  pickerChipTextActive: { color: '#fff' },

  close: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  closeText: { ...type.button, color: colors.textMuted },
  pressed: { opacity: 0.8 },
});
