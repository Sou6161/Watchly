import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { Button, Screen } from '../src/components/ui';
import { useUser } from '../src/stores/auth';
import { api } from '../src/lib/api';
import type { TasteProfile } from '../src/lib/types';
import { bgGradient, colors, radii, spacing, type } from '../src/theme';

/**
 * The shareable "sync card" — a branded image of how in sync you two are, for
 * WhatsApp/Instagram. Every share is a tiny ad that shows off the couple angle,
 * so it's the app's cheapest growth loop: no infra, just a pretty picture.
 */
export default function ShareTaste() {
  const router = useRouter();
  const user = useUser();
  const cardRef = useRef<View>(null);

  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<TasteProfile>('/api/me/taste');
        if (!cancelled) setProfile(res);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Capture the branded card view to a PNG, then hand it to the OS share sheet.
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share your sync',
        });
      }
    } catch {
      // A cancelled or failed share is a no-op — nothing to recover.
    } finally {
      setSharing(false);
    }
  };

  const pct = profile?.agreement == null ? null : Math.round(profile.agreement * 100);
  const ready = pct !== null;

  return (
    <Screen>
      <View style={s.topBar}>
        <Text style={s.back} onPress={() => router.back()}>
          ‹ Back
        </Text>
      </View>

      <View style={s.center}>
        {failed ? (
          <Text style={s.hint}>Couldn’t load your taste. Try again in a moment.</Text>
        ) : !profile ? (
          <ActivityIndicator color={colors.red} />
        ) : !ready ? (
          <Text style={s.hint}>
            Play a few nights first — the card needs some yeses to measure.
          </Text>
        ) : (
          <>
            {/* collapsable=false keeps the view in the native tree so it can be
                captured; without it Android may flatten it away. */}
            <View ref={cardRef} collapsable={false} style={s.cardShadow}>
              <LinearGradient colors={bgGradient} style={s.card}>
                <Text style={s.brand}>Watchly</Text>

                <View style={s.pctWrap}>
                  <Text style={s.pctBig}>{pct}%</Text>
                  <Text style={s.pctLabel}>in sync</Text>
                </View>

                <Text style={s.couple}>
                  {user?.displayName ?? 'Us'} &amp; {partnerName(profile)}
                </Text>

                {profile.loves.length > 0 && (
                  <View style={s.genres}>
                    {profile.loves.slice(0, 3).map((g) => (
                      <View key={g.genre} style={s.genre}>
                        <Text style={s.genreText}>{g.genre}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <Text style={s.footer}>{footerLine(profile)}</Text>
              </LinearGradient>
            </View>

            <View style={s.actions}>
              <Button
                label={sharing ? 'Opening…' : 'Share our sync'}
                onPress={share}
                loading={sharing}
              />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

/** We don't carry a single partner name (nights have different guests), so keep it warm and generic. */
function partnerName(_profile: TasteProfile): string {
  return 'my person';
}

function footerLine(profile: TasteProfile): string {
  if (profile.watchedTogether > 0) {
    return `${profile.nights} nights · ${profile.watchedTogether} watched together`;
  }
  return `${profile.nights} movie night${profile.nights === 1 ? '' : 's'} and counting`;
}

const s = StyleSheet.create({
  topBar: { paddingTop: spacing.sm },
  back: { ...type.label, color: colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  hint: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },

  cardShadow: {
    shadowColor: colors.red,
    shadowOpacity: 0.3,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
    borderRadius: radii.card,
  },
  card: {
    width: 300,
    height: 380,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.gold,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { ...type.title, fontSize: 22, color: colors.gold, letterSpacing: 0.5 },
  pctWrap: { alignItems: 'center' },
  pctBig: { ...type.hero, fontSize: 92, lineHeight: 96, color: colors.text },
  pctLabel: { ...type.title, fontSize: 20, color: colors.textMuted, marginTop: -8 },
  couple: { ...type.label, color: colors.text, textAlign: 'center' },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  genre: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreText: { ...type.caption, color: colors.text },
  footer: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

  actions: { alignSelf: 'stretch', paddingHorizontal: spacing.xl },
});
