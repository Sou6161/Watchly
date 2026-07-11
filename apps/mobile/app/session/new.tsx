import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DURATION_FILTERS, MOODS } from '@watchly/shared';
import { Button, Chip, FormError, Heading, Screen, Subheading } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { useUser } from '../../src/stores/auth';
import { colors, radii, spacing, type } from '../../src/theme';

export default function NewSession() {
  const router = useRouter();
  const user = useUser();
  const { mode } = useLocalSearchParams<{ mode: 'SAME_DEVICE' | 'MULTI_DEVICE' }>();

  const create = useSessionStore((s) => s.create);
  const connect = useSessionStore((s) => s.connect);
  const creating = useSessionStore((s) => s.creating);
  const error = useSessionStore((s) => s.error);

  const sameDevice = mode !== 'MULTI_DEVICE';

  const [mood, setMood] = useState<string | null>(null);
  const [duration, setDuration] = useState<string>('any');
  const [personA, setPersonA] = useState(user?.displayName ?? 'Person A');
  const [personB, setPersonB] = useState('Person B');

  const start = async () => {
    const maxRuntime = DURATION_FILTERS.find((d) => d.id === duration)?.maxRuntime ?? null;

    const created = await create({
      mode: sameDevice ? 'SAME_DEVICE' : 'MULTI_DEVICE',
      mood,
      maxRuntime,
      ...(sameDevice && {
        personALabel: personA.trim() || 'Person A',
        personBLabel: personB.trim() || 'Person B',
      }),
    });

    if (!created) return; // Store holds the error; FormError renders it.

    if (sameDevice) {
      router.replace('/session/swipe');
      return;
    }

    // Open the socket BEFORE showing the code. Otherwise a partner who types it in
    // fast enough could join before we're listening, and the session:joined event
    // would fire into a room we aren't in yet — leaving person A stuck on the
    // waiting screen forever while person B swipes.
    await connect();
    router.replace('/session/waiting');
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Tonight&apos;s rules</Heading>
        <Subheading>
          {sameDevice
            ? 'One phone, two people, fifteen trailers each.'
            : 'Two phones. Swipe at your own pace.'}
        </Subheading>

        {!!error && <View style={s.errorWrap}><FormError message={error} /></View>}

        {sameDevice && (
          <>
            <Text style={s.sectionLabel}>Who&apos;s watching?</Text>
            <View style={s.names}>
              <TextInput
                value={personA}
                onChangeText={setPersonA}
                style={s.nameInput}
                placeholder="Person A"
                placeholderTextColor={colors.textFaint}
                maxLength={24}
              />
              <Text style={s.amp}>&</Text>
              <TextInput
                value={personB}
                onChangeText={setPersonB}
                style={s.nameInput}
                placeholder="Person B"
                placeholderTextColor={colors.textFaint}
                maxLength={24}
              />
            </View>
          </>
        )}

        <Text style={s.sectionLabel}>What are you in the mood for?</Text>
        <View style={s.row}>
          {MOODS.map((m) => (
            <Chip
              key={m.id}
              label={`${m.emoji}  ${m.label}`}
              selected={mood === m.id}
              // Tapping the selected mood clears it — "surprise us" is a valid answer.
              onPress={() => setMood((prev) => (prev === m.id ? null : m.id))}
            />
          ))}
        </View>

        <Text style={s.sectionLabel}>How long have you got?</Text>
        <View style={s.row}>
          {DURATION_FILTERS.map((d) => (
            <Chip
              key={d.id}
              label={d.label}
              selected={duration === d.id}
              onPress={() => setDuration(d.id)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Button
          label={creating ? 'Building your deck…' : 'Start swiping'}
          onPress={start}
          loading={creating}
        />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingTop: spacing.xl, paddingBottom: spacing.lg },
  errorWrap: { marginTop: spacing.lg },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  names: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameInput: {
    ...type.body,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  amp: { ...type.body, color: colors.textFaint },
  footer: { paddingVertical: spacing.md },
});
