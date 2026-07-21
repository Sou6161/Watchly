import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { serviceById, type Region } from '@watchly/shared';
import { openInService } from '../lib/deeplinks';
import { track } from '../lib/analytics';
import type { PublicTitle } from '../lib/types';
import { colors, radii, spacing, type } from '../theme';

/**
 * The "Play on X" buttons — the punchline of the whole app, so it lives in one
 * place. Shows only the services this title actually streams on in the given
 * region.
 */
export function PlayButtons({ title, region }: { title: PublicTitle; region: Region }) {
  const services = (title.watchProviders[region]?.flatrate ?? [])
    .map(serviceById)
    .filter((svc) => svc !== undefined);

  if (services.length === 0) return null;

  return (
    <View style={s.services}>
      {services.map((svc) => (
        <Pressable
          key={svc.id}
          accessibilityRole="button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            track.serviceOpened({ service: svc.id, titleType: title.type });
            openInService(svc.id, title.title);
          }}
          style={({ pressed }) => [s.serviceBtn, { borderColor: svc.color }, pressed && s.pressed]}
        >
          <View style={[s.dot, { backgroundColor: svc.color }]} />
          <Text style={s.serviceLabel} numberOfLines={1}>
            Play on {svc.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  services: { gap: spacing.sm, alignSelf: 'stretch' },
  serviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serviceLabel: { ...type.label, color: colors.text, flexShrink: 1 },
  pressed: { opacity: 0.85 },
});
