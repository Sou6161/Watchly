import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DURATION_FILTERS, MOODS, WATCH_KINDS, type WatchKind } from '@watchly/shared';
import * as Haptics from 'expo-haptics';
import { Button, Chip, FormError, Heading, Screen, Subheading } from '../../src/components/ui';
import { useSessionStore } from '../../src/stores/session';
import { useUser } from '../../src/stores/auth';
import { track } from '../../src/lib/analytics';
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

  // Movie night or series night. Defaults to a movie — the classic 'movie night'
  // case — but it's the first thing on screen, so switching is one tap.
  const [kind, setKind] = useState<WatchKind>('MOVIE');
  const [mood, setMood] = useState<string | null>(null);
  const [duration, setDuration] = useState<string>('any');
  const [personA, setPersonA] = useState(user?.displayName ?? 'Person A');
  const [personB, setPersonB] = useState('Person B');
  // Multi-device only: are both people here now, or does one swipe first and the
  // other finish later?
  const [asyncMode, setAsyncMode] = useState(false);

  const start = async () => {
    const maxRuntime = DURATION_FILTERS.find((d) => d.id === duration)?.maxRuntime ?? null;

    const created = await create({
      mode: sameDevice ? 'SAME_DEVICE' : 'MULTI_DEVICE',
      titleType: kind,
      mood,
      // The server ignores this for series anyway; not sending it keeps the
      // request honest about what was actually asked for.
      maxRuntime: kind === 'MOVIE' ? maxRuntime : null,
      async: !sameDevice && asyncMode,
      ...(sameDevice && {
        personALabel: personA.trim() || 'Person A',
        personBLabel: personB.trim() || 'Person B',
      }),
    });

    if (!created) return; // Store holds the error; FormError renders it.

    track.sessionStarted({
      mode: sameDevice ? 'SAME_DEVICE' : 'MULTI_DEVICE',
      titleType: kind,
      mood,
      maxRuntime: kind === 'MOVIE' ? maxRuntime : null,
    });

    // Same-device and async both send person A straight to the deck — neither
    // waits in the live lobby. (Async has no live partner; the code is shared
    // after A finishes, from the share screen.)
    if (sameDevice || asyncMode) {
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

        {!sameDevice && (
          <>
            <Text style={s.sectionLabel}>When are you both swiping?</Text>
            <View style={s.kindRow}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: !asyncMode }}
                onPress={() => {
                  Haptics.selectionAsync();
                  setAsyncMode(false);
                }}
                style={({ pressed }) => [
                  s.kindCard,
                  !asyncMode && s.kindCardActive,
                  pressed && s.kindPressed,
                ]}
              >
                <Text style={s.kindEmoji}>👀</Text>
                <Text style={[s.kindLabel, !asyncMode && s.kindLabelActive]}>Both now</Text>
                <Text style={s.kindBlurb}>They join with a code and you swipe together.</Text>
              </Pressable>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: asyncMode }}
                onPress={() => {
                  Haptics.selectionAsync();
                  setAsyncMode(true);
                }}
                style={({ pressed }) => [
                  s.kindCard,
                  asyncMode && s.kindCardActive,
                  pressed && s.kindPressed,
                ]}
              >
                <Text style={s.kindEmoji}>⏳</Text>
                <Text style={[s.kindLabel, asyncMode && s.kindLabelActive]}>I&apos;ll go first</Text>
                <Text style={s.kindBlurb}>Swipe now, send them the code to finish later.</Text>
              </Pressable>
            </View>
          </>
        )}

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

        {/* Asked first, and deliberately bigger than the other filters: it decides
            what kind of night this is, and everything below depends on it. */}
        <Text style={s.sectionLabel}>Tonight you want…</Text>
        <View style={s.kindRow}>
          {WATCH_KINDS.map((k) => (
            <Pressable
              key={k.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: kind === k.id }}
              onPress={() => {
                Haptics.selectionAsync();
                setKind(k.id);
              }}
              style={({ pressed }) => [
                s.kindCard,
                kind === k.id && s.kindCardActive,
                pressed && s.kindPressed,
              ]}
            >
              <Text style={s.kindEmoji}>{k.emoji}</Text>
              <Text style={[s.kindLabel, kind === k.id && s.kindLabelActive]}>{k.label}</Text>
              <Text style={s.kindBlurb}>{k.blurb}</Text>
            </Pressable>
          ))}
        </View>

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

        {/* Movies only. TMDB reports a series' runtime PER EPISODE, so "under 100
            min" would happily return a 62-episode show — the opposite of what
            someone with 90 minutes tonight is asking for. */}
        {kind === 'MOVIE' && (
          <>
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
          </>
        )}
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

  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  kindCardActive: { borderColor: colors.red, backgroundColor: colors.surfaceActive },
  kindPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  kindEmoji: { fontSize: 28 },
  kindLabel: { ...type.button, color: colors.textMuted },
  kindLabelActive: { color: colors.text },
  kindBlurb: { ...type.caption, color: colors.textFaint },
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
