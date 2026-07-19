import { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useAuthLoading, useAuthStore, useUser } from '../src/stores/auth';
import { initAnalytics } from '../src/lib/analytics';
import { colors } from '../src/theme';

/**
 * Sends the user wherever their auth state says they belong, and — critically —
 * *away* from anywhere they don't. Redirecting only on sign-in would let a
 * signed-out user linger on /home after their refresh token expires.
 */
function useProtectedRoute() {
  const user = useUser();
  const loading = useAuthLoading();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const group = segments[0];
    const inAuthFlow = group === 'auth';
    const onOnboarding = group === 'onboarding';

    if (!user) {
      if (!inAuthFlow) router.replace('/auth/login');
      return;
    }

    // Signed in but never picked region/services: onboarding is the only stop.
    if (!user.onboarded) {
      if (!onOnboarding) router.replace('/onboarding');
      return;
    }

    // Fully set up — bounce off the auth and onboarding screens.
    if (inAuthFlow || onOnboarding) router.replace('/home');
  }, [user, loading, segments, router]);
}

function RootNavigator() {
  const restore = useAuthStore((s) => s.restore);

  // Resume an existing session on cold start.
  useEffect(() => {
    initAnalytics();
    restore();
  }, [restore]);

  useProtectedRoute();

  // The Stack is ALWAYS mounted — never swapped out for a loading view. Returning
  // a spinner here instead would leave the navigator unmounted, and expo-router
  // silently discards any router.replace() issued before it mounts. That made the
  // redirect off the index route a no-op and left the app sitting on a blank
  // screen with nothing logged. The loading state belongs on the index route
  // (which renders a spinner), not in place of the navigator.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgTop },
        animation: 'fade',
      }}
    />
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSerifDisplay_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Hold rather than flash system-font text that reflows once the real fonts
  // land. fontError still lets us through — shipping in a fallback font beats a
  // permanently blank screen. The spinner matters: an empty View here is
  // indistinguishable from a crash, which is exactly how the last blank-screen
  // bug managed to hide.
  if (!fontsLoaded && !fontError) {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={s.flex}>
      <StatusBar style="light" />
      <RootNavigator />
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  boot: {
    flex: 1,
    backgroundColor: colors.bgTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
