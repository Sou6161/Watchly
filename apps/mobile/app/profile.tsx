import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { REGIONS, servicesForRegion, type Region } from '@watchly/shared';
import { Button, Chip, FormError, Heading, Screen } from '../src/components/ui';
import { useAuthStore, useUser } from '../src/stores/auth';
import { ApiError } from '../src/lib/api';
import { colors, radii, spacing, type } from '../src/theme';

const REGION_LABELS: Record<Region, string> = { IN: '🇮🇳  India', US: '🇺🇸  United States' };

export default function Profile() {
  const user = useUser();
  const updateMe = useAuthStore((s) => s.updateMe);
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const router = useRouter();

  const [region, setRegion] = useState<Region>(user?.region ?? 'IN');
  const [selected, setSelected] = useState<string[]>(user?.services ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const available = useMemo(() => servicesForRegion(region), [region]);

  if (!user) return null;

  const dirty =
    region !== user.region ||
    selected.length !== user.services.length ||
    selected.some((id) => !user.services.includes(id));

  const changeRegion = (next: Region) => {
    setRegion(next);
    setSaved(false);
    const allowed = new Set(servicesForRegion(next).map((s) => s.id));
    setSelected((prev) => prev.filter((id) => allowed.has(id)));
  };

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateMe({ region, services: selected });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancelDelete = () => {
    setDeleting(false);
    setPassword('');
    setDeleteError('');
  };

  const confirmDelete = async () => {
    setDeletingBusy(true);
    setDeleteError('');
    try {
      await deleteAccount(password);
      // No navigation needed — the root layout redirects to /auth/login the moment
      // `user` becomes null.
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not delete. Try again.');
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={s.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Heading>Profile</Heading>
        <Text style={s.email}>{user.email}</Text>

        {!!error && <FormError message={error} />}

        <Text style={s.sectionLabel}>Region</Text>
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

        {user.partner && (
          <>
            <Text style={s.sectionLabel}>Saved partner</Text>
            <View style={s.partnerRow}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {user.partner.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={s.partnerName}>{user.partner.displayName}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => updateMe({ partnerId: null })}
                style={({ pressed }) => pressed && s.pressed}
              >
                <Text style={s.removeText}>Remove</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        {saved && !dirty && <Text style={s.saved}>Saved.</Text>}
        <Button
          label="Save changes"
          onPress={save}
          loading={busy}
          disabled={!dirty || selected.length === 0}
        />
        <Button label="Sign out" onPress={logout} variant="ghost" />
        <Pressable
          hitSlop={8}
          onPress={() => setDeleting(true)}
          style={({ pressed }) => [s.deleteLink, pressed && s.pressed]}
        >
          <Text style={s.deleteLinkText}>Delete my account</Text>
        </Pressable>
      </View>

      {/* Required by App Store Guideline 5.1.1(v): an app that lets you create an
          account must let you delete it, in-app. Password-gated and spelled out,
          because it is irreversible and nobody should reach it by fumbling. */}
      <Modal visible={deleting} transparent animationType="fade" onRequestClose={cancelDelete}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Delete your account?</Text>
            <Text style={s.modalBody}>
              This erases your account, your sessions and everything you swiped. It
              can&apos;t be undone.
            </Text>

            {!!deleteError && (
              <View style={s.modalError}>
                <FormError message={deleteError} />
              </View>
            )}

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              autoCapitalize="none"
              style={s.modalInput}
            />

            <View style={s.modalActions}>
              <Button
                label={deletingBusy ? 'Deleting…' : 'Delete forever'}
                onPress={confirmDelete}
                loading={deletingBusy}
                disabled={password.length === 0}
              />
              <Button label="Keep my account" onPress={cancelDelete} variant="ghost" />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  email: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
  },
  avatarText: { ...type.button, color: colors.text },
  partnerName: { ...type.body, color: colors.text, flex: 1 },
  removeText: { ...type.caption, color: colors.danger },
  pressed: { opacity: 0.7 },

  footer: { gap: spacing.sm, paddingBottom: spacing.md },
  saved: { ...type.caption, color: colors.gold, textAlign: 'center' },

  deleteLink: { alignSelf: 'center', paddingVertical: spacing.sm },
  deleteLinkText: { ...type.caption, color: colors.textFaint },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,4,24,0.85)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: '#241640',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalTitle: { ...type.title, fontSize: 22, color: colors.text },
  modalBody: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  modalError: { marginTop: spacing.md },
  modalInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 52,
    marginTop: spacing.lg,
  },
  modalActions: { marginTop: spacing.lg, gap: spacing.sm },
});
