import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { serviceById } from '@watchly/shared';
import { Button, Heading, Screen, Subheading } from '../src/components/ui';
import { useUser } from '../src/stores/auth';
import { colors, radii, spacing, type } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const user = useUser();
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
        <Button
          label="Together on this phone"
          onPress={() => router.push('/session/new?mode=SAME_DEVICE')}
        />
        <Button
          label="On separate phones"
          onPress={() => router.push('/session/new?mode=MULTI_DEVICE')}
          variant="ghost"
        />
        <Button
          label="Join with a code"
          onPress={() => router.push('/session/join')}
          variant="ghost"
        />
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
});
