import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useAuthLoading, useAuthStore, useUser } from '../src/stores/auth';
import { AnimatedSplash } from '../src/components/AnimatedSplash';
import { initAnalytics } from '../src/lib/analytics';
import { colors } from '../src/theme';

// Keep the native splash up until the tree paints — the animated splash takes
// over from there, so the hand-off is seamless and never flashes a blank frame.
SplashScreen.preventAutoHideAsync().catch(() => {});

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
  // Override expo-router's DEFAULT navigation theme, which follows the system
  // colour scheme and so paints a WHITE card/container behind every screen. During
  // a transition (and the back gesture) that white flashed through for a frame
  // before our dark Screen painted. Handing the navigator a dark theme means the
  // container is already our colour — no seam, in either direction.
  return (
    <ThemeProvider value={navTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgBottom },
          animation: 'fade',
        }}
      />
    </ThemeProvider>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bgBottom,
    card: colors.bgBottom,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
  });

  const [splashDone, setSplashDone] = useState(false);

  // Fonts drive readiness: mounting the tree in a fallback font would reflow the
  // moment DM Serif lands. fontError still lets us through — shipping in a system
  // font beats a permanently blank screen.
  const ready = fontsLoaded || fontError;

  // Hide the NATIVE splash the moment we're ready to render — not from an
  // onLayout callback. onLayout depends on a native view event actually firing,
  // which is exactly the kind of thing that can silently never happen (especially
  // under Expo Go's own splash handling) and leaves the app stuck behind the
  // native splash forever. A plain effect keyed on `ready` is the documented,
  // reliable way to do this.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Return null, not a spinner: the native splash is still covering the screen, so
  // there's nothing to see behind it and nothing to flash.
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={s.flex}>
      <StatusBar style="light" />
      <RootNavigator />
      {/* Sits above the app and dissolves once its animation completes. */}
      {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  // Dark, so even the root view behind the navigator never flashes white.
  flex: { flex: 1, backgroundColor: colors.bgBottom },
});
