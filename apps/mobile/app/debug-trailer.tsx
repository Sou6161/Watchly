import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { WebView } from 'react-native-webview';
import { Screen } from '../src/components/ui';
import { colors, spacing, type } from '../src/theme';

/**
 * TEMPORARY diagnostic screen. Delete once trailers are confirmed working.
 *
 * Three tests, simplest first, so the failure can be located instead of guessed
 * at. Each one strips away a layer of what the real card does:
 *
 *   1. A bare WebView — does the WebView engine work here at all?
 *   2. YoutubePlayer with NO styling, NO animation, NO absolute positioning
 *   3. YoutubePlayer sized and cropped the way the real card does it
 *
 * Whichever is the first to fail tells us where the bug actually is.
 * Reach it at /debug-trailer.
 */
export default function DebugTrailer() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) =>
    setLog((prev) => [`${new Date().toISOString().slice(14, 19)}  ${line}`, ...prev].slice(0, 14));

  // House of the Dragon — verified live as a real, embeddable video.
  const VIDEO_ID = 'DotnJ7tTA34';

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.h}>1 · Bare WebView</Text>
        <Text style={s.note}>Green box = the WebView engine works.</Text>
        <View style={s.box}>
          <WebView
            source={{ html: '<body style="background:#0a0;margin:0"><h2>WebView OK</h2></body>' }}
            style={s.fill}
            onError={(e) => add(`[1] webview error: ${e.nativeEvent.description}`)}
          />
        </View>

        <Text style={s.h}>2 · Player, no styling at all</Text>
        <Text style={s.note}>The library in its simplest possible form.</Text>
        <View style={s.box}>
          <YoutubePlayer
            height={200}
            play
            videoId={VIDEO_ID}
            onReady={() => add('[2] onReady')}
            onError={(e: string) => add(`[2] onError: ${e}`)}
            onChangeState={(st: string) => add(`[2] state: ${st}`)}
          />
        </View>

        <Text style={s.h}>3 · Player, cropped like the real card</Text>
        <Text style={s.note}>Oversized + absolutely positioned inside overflow:hidden.</Text>
        <View style={[s.box, s.cropped]}>
          <View style={s.cropInner} pointerEvents="none">
            <YoutubePlayer
              height={200}
              width={356}
              play
              forceAndroidAutoplay
              videoId={VIDEO_ID}
              initialPlayerParams={{ controls: false, playsinline: true, rel: false }}
              webViewProps={{
                mediaPlaybackRequiresUserAction: false,
                allowsInlineMediaPlayback: true,
                androidLayerType: 'none',
              }}
              onReady={() => add('[3] onReady')}
              onError={(e: string) => add(`[3] onError: ${e}`)}
              onChangeState={(st: string) => add(`[3] state: ${st}`)}
            />
          </View>
        </View>

        <Text style={s.h}>Events</Text>
        <View style={s.log}>
          {log.length === 0 ? (
            <Text style={s.logLine}>nothing yet…</Text>
          ) : (
            log.map((l, i) => (
              <Text key={i} style={s.logLine}>
                {l}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingVertical: spacing.xl, gap: spacing.sm },
  h: { ...type.label, color: colors.gold, marginTop: spacing.lg },
  note: { ...type.caption, color: colors.textFaint, marginBottom: spacing.xs },
  box: { height: 200, backgroundColor: colors.purple, overflow: 'hidden' },
  fill: { flex: 1 },
  cropped: { width: 200 },
  cropInner: { position: 'absolute', top: 0, left: -78, width: 356, height: 200 },
  log: {
    backgroundColor: '#000',
    padding: spacing.sm,
    minHeight: 120,
    marginTop: spacing.xs,
  },
  logLine: { color: '#0f0', fontSize: 11, fontFamily: 'monospace' },
});
