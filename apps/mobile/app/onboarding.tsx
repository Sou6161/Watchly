import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { REGIONS, servicesForRegion, type Region } from '@watchly/shared';
import { Button, Chip, FormError, Heading, Screen, Subheading } from '../src/components/ui';
import { useAuthStore, useUser } from '../src/stores/auth';
import { ApiError } from '../src/lib/api';
import { colors, spacing, type } from '../src/theme';

const REGION_LABELS: Record<Region, string> = { IN: '🇮🇳  India', US: '🇺🇸  United States' };

export default function Onboarding() {
  const user = useUser();
  const updateMe = useAuthStore((s) => s.updateMe);
  const [region, setRegion] = useState<Region>(user?.region ?? 'IN');
  const [selected, setSelected] = useState<string[]>(user?.services ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const available = useMemo(() => servicesForRegion(region), [region]);

  const changeRegion = (next: Region) => {
    setRegion(next);
    // Zee5 doesn't exist in the US. Keeping it selected across a region switch
    // would send the server services it will reject, so drop the strays.
    const allowed = new Set(servicesForRegion(next).map((s) => s.id));
    setSelected((prev) => prev.filter((id) => allowed.has(id)));
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      // `onboarded` flips to true server-side the moment services is non-empty,
      // which is what lets useProtectedRoute forward us to /home.
      await updateMe({ region, services: selected });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.header}>
          <Heading>What can you stream?</Heading>
          <Subheading>
            We&apos;ll only show you titles you can actually press play on tonight.
          </Subheading>
        </View>

        {!!error && <FormError message={error} />}

        <Text style={s.sectionLabel}>Where are you?</Text>
        <View style={s.row}>
          {REGIONS.map((r) => (
            <Chip
              key={r}
              label={REGION_LABELS[r]}
              selected={region === r}
              onPress={() => changeRegion(r)}
            />
          ))}
        </View>

        <Text style={s.sectionLabel}>Your subscriptions</Text>
        <View style={s.row}>
          {available.map((svc) => (
            <Chip
              key={svc.id}
              label={svc.label}
              accent={svc.color}
              selected={selected.includes(svc.id)}
              onPress={() => toggle(svc.id)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Button
          label={selected.length > 0 ? 'Start watching' : 'Pick at least one'}
          onPress={submit}
          loading={busy}
          disabled={selected.length === 0}
        />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingTop: spacing.xxl, paddingBottom: spacing.lg },
  header: { marginBottom: spacing.xl },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
