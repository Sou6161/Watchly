import { Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Button, Heading, Screen, Subheading } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { colors, radii, spacing, type } from '../../src/theme';

export default function ShareSession() {
  const router = useRouter();
  const { code, partner } = useLocalSearchParams<{ code: string; partner?: string }>();
  const reset = useSessionStore((s) => s.reset);

  const partnerLabel = partner && partner.length > 0 ? partner : 'them';

  const done = () => {
    reset();
    router.replace('/home');
  };

  const shareCode = () => {
    Share.share({
      message: `Join my Watchly pick with code ${code} — watchly://session/join?code=${code}`,
    }).catch(() => {});
  };

  if (!code) {
    // Nothing to share without a code — bail back home rather than show a blank.
    router.replace('/home');
    return null;
  }

  return (
    <Screen>
      <Animated.View entering={FadeIn.duration(400)} style={s.body}>
        <Heading>Your picks are in.</Heading>
        <Subheading>Send {partnerLabel} the code. You&apos;ll have your matches the moment they finish theirs.</Subheading>

        <View style={s.qrWrap}>
          <QRCode
            value={`watchly://session/join?code=${code}`}
            size={168}
            backgroundColor="transparent"
            color={colors.text}
          />
        </View>

        <View style={s.codeBox}>
          {code.split('').map((ch, i) => (
            <View key={`${ch}-${i}`} style={s.charBox}>
              <Text style={s.char}>{ch}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={s.footer}>
        <Button label={`Send ${partnerLabel} the code`} onPress={shareCode} />
        <Button label="Done" onPress={done} variant="ghost" />
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
  footer: { gap: spacing.sm, paddingVertical: spacing.md },
});
