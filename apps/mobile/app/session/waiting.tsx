import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { Button, Heading, Screen, Subheading } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { colors, radii, spacing, type } from '../../src/theme';

/**
 * Multi-device lobby: person A waits here while person B joins with the code.
 * The socket wakes this screen the moment they do — no polling, no "tap to
 * refresh".
 */
export default function Waiting() {
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const partnerConnected = useSessionStore((s) => s.partnerConnected);
  const connect = useSessionStore((s) => s.connect);
  const reset = useSessionStore((s) => s.reset);

  useEffect(() => {
    connect();
  }, [connect]);

  // Person B has joined — go swipe.
  useEffect(() => {
    if (partnerConnected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/session/swipe');
    }
  }, [partnerConnected, router]);

  useEffect(() => {
    if (!session) router.replace('/home');
  }, [session, router]);

  if (!session) return null;

  const cancel = () => {
    reset();
    router.replace('/home');
  };

  return (
    <Screen>
      <Animated.View entering={FadeIn.duration(400)} style={s.body}>
        <Heading>Their turn to join.</Heading>
        <Subheading>Read out the code, or let them scan this.</Subheading>

        <View style={s.qrWrap}>
          {/* A deep link into the actual join route (watchly:// is our scheme in
              app.json), so scanning from the phone's own camera opens Watchly with
              the code already filled. The join screen also accepts a bare 6-char
              code, so a scan from inside the app works either way. */}
          <QRCode
            value={`watchly://session/join?code=${session.code}`}
            size={168}
            backgroundColor="transparent"
            color={colors.text}
          />
        </View>

        <View style={s.codeBox}>
          {session.code.split('').map((ch, i) => (
            <View key={`${ch}-${i}`} style={s.charBox}>
              <Text style={s.char}>{ch}</Text>
            </View>
          ))}
        </View>

        <View style={s.hintRow}>
          <ActivityIndicator color={colors.textFaint} size="small" />
          <Text style={s.hint}>Waiting for them to join…</Text>
        </View>
      </Animated.View>

      <View style={s.footer}>
        <Button label="Cancel" onPress={cancel} variant="ghost" />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
  qrWrap: {
    alignSelf: 'center',
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeBox: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  charBox: {
    flex: 1,
    aspectRatio: 0.78,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  char: { ...type.title, color: colors.gold },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  hint: { ...type.caption, color: colors.textFaint },
  footer: { paddingVertical: spacing.md },
});
