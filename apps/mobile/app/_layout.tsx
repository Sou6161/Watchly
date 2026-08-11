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

SplashScreen.preventAutoHideAsync().catch(() => {});

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

  const ready = fontsLoaded || fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

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
