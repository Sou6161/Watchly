import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthLoading, useUser } from '../src/stores/auth';
import { colors } from '../src/theme';

/**
 * The entry route decides where you actually belong.
 *
 * This uses <Redirect> rather than an imperative router.replace() in an effect:
 * <Redirect> is evaluated during render by the navigator itself, so it can't fire
 * before the navigator is ready. An effect-driven replace() raced the Stack's
 * mount, got silently dropped, and left the app on this route rendering nothing —
 * a blank screen with no error to go on.
 */
export default function Index() {
  const user = useUser();
  const loading = useAuthLoading();

  // Still checking SecureStore for an existing session.
  if (loading) {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth/login" />;
  if (!user.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}

const s = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bgTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
