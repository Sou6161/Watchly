import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { serviceById } from '@watchly/shared';
import { Button, Heading, Screen, Subheading } from '../src/components/ui';
import { useAuth } from '../src/lib/auth-context';
import { colors, radii, spacing, type } from '../src/theme';

export default function Home() {
  const { user } = useAuth();
  if (!user) return null;

  const services = user.services.map(serviceById).filter((s) => s !== undefined);

  return (
    <Screen>
      <View style={s.topBar}>
        <Link href="/profile" asChild>
          <Pressable hitSlop={12}>
            <Text style={s.profileLink}>Profile</Text>
          </Pressable>
        </Link>
      </View>

      <View style={s.body}>
        <Heading>Evening, {user.displayName}.</Heading>
        <Subheading>Two people, fifteen trailers, one decision.</Subheading>

        <View style={s.services}>
          {services.map((svc) => (
            <View key={svc.id} style={s.serviceTag}>
              <View style={[s.dot, { backgroundColor: svc.color }]} />
              <Text style={s.serviceLabel}>{svc.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.actions}>
        {/* Wired up in Feature 3 (same-device) and Feature 4 (multi-device). */}
        <Button label="Start a session" onPress={() => {}} disabled />
        <Button label="Join a session" onPress={() => {}} variant="ghost" disabled />
        <Text style={s.soon}>Sessions land next — catalog sync is up first.</Text>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: { alignItems: 'flex-end', paddingTop: spacing.sm },
  profileLink: { ...type.label, color: colors.textMuted },
  body: { flex: 1, justifyContent: 'center' },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  serviceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serviceLabel: { ...type.caption, color: colors.textMuted },
  actions: { gap: spacing.md, paddingBottom: spacing.md },
  soon: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
});
