import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Button, FormError, Heading, Screen, Subheading } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { colors, radii, spacing, type } from '../../src/theme';

const CODE_LENGTH = 6;

export default function Join() {
  const router = useRouter();
  // Prefilled when arriving via a scanned watchly://session/join?code=XXXXXX link.
  const { code: prefill } = useLocalSearchParams<{ code?: string }>();

  const join = useSessionStore((s) => s.join);
  const connect = useSessionStore((s) => s.connect);
  const busy = useSessionStore((s) => s.creating);
  const error = useSessionStore((s) => s.error);

  const [code, setCode] = useState((prefill ?? '').toUpperCase());
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Guards against the camera firing onBarcodeScanned dozens of times a second
  // while the join request is still in flight.
  const handled = useRef(false);
  const inputRef = useRef<TextInput | null>(null);

  const submit = async (value: string) => {
    const id = await join(value);
    if (!id) {
      handled.current = false; // Let them try again.
      return;
    }
    await connect();
    router.replace('/session/swipe');
  };

  // Arriving with a full code from a deep link: just go.
  useEffect(() => {
    if (prefill && prefill.length === CODE_LENGTH && !handled.current) {
      handled.current = true;
      submit(prefill.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    handled.current = false;
    setScanning(true);
  };

  const onScan = (raw: string) => {
    if (handled.current) return;

    // Accept both the deep link and a bare code, so a QR from any source works.
    const match = raw.match(/([A-Z0-9]{6})\s*$/i);
    if (!match) return;

    handled.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanning(false);
    const scanned = match[1]!.toUpperCase();
    setCode(scanned);
    submit(scanned);
  };

  if (scanning) {
    return (
      <Screen>
        <View style={s.scannerWrap}>
          <CameraView
            style={s.scanner}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScan(data)}
          />
          <View style={s.reticle} pointerEvents="none" />
        </View>
        <Text style={s.scanHint}>Point at their code</Text>
        <View style={s.footer}>
          <Button label="Enter it manually" onPress={() => setScanning(false)} variant="ghost" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.body}>
        <Heading>Join their session.</Heading>
        <Subheading>Six characters, on their screen.</Subheading>

        {!!error && (
          <View style={s.errorWrap}>
            <FormError message={error} />
          </View>
        )}

        <Pressable style={s.codeRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <View key={i} style={[s.charBox, i === code.length && s.charBoxActive]}>
              <Text style={s.char}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </Pressable>

        {/* The real input is invisible: the six boxes above are just a prettier
            rendering of it. One field, one keyboard, no per-box focus juggling. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => {
            const next = t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
            setCode(next);
            if (next.length === CODE_LENGTH) {
              Haptics.selectionAsync();
              submit(next);
            }
          }}
          style={s.hiddenInput}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          keyboardType="visible-password"
          maxLength={CODE_LENGTH}
        />

        <Pressable onPress={openScanner} style={s.scanLink}>
          <Text style={s.scanLinkText}>or scan their QR code</Text>
        </Pressable>
      </View>

      <View style={s.footer}>
        <Button
          label={busy ? 'Joining…' : 'Join'}
          onPress={() => submit(code)}
          loading={busy}
          disabled={code.length !== CODE_LENGTH}
        />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
  errorWrap: { marginTop: spacing.lg },

  codeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
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
  charBoxActive: { borderColor: colors.red },
  char: { ...type.title, color: colors.gold },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },

  scanLink: { alignSelf: 'center', marginTop: spacing.xl, padding: spacing.sm },
  scanLinkText: { ...type.body, color: colors.red },

  scannerWrap: {
    flex: 1,
    marginTop: spacing.lg,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.purple,
  },
  scanner: { flex: 1 },
  reticle: {
    position: 'absolute',
    top: '25%',
    left: '15%',
    right: '15%',
    bottom: '25%',
    borderWidth: 2,
    borderColor: colors.gold,
    borderRadius: radii.md,
  },
  scanHint: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  footer: { paddingVertical: spacing.md },
});
