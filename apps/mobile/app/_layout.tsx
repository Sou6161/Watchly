import { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { colors } from '../src/theme';

/**
 * Sends the user wherever their auth state says they belong, and — critically —
 * *away* from anywhere they don't. Redirecting only on sign-in would let a
 * signed-out user linger on /home after their refresh token expires.
 */
function useProtectedRoute() {
  const { user, loading } = useAuth();
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
  const { loading } = useAuth();
  useProtectedRoute();

  if (loading) {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

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

  // Render nothing rather than flash system-font text that reflows once the real
  // fonts land. fontError still lets us through — shipping the app in a fallback
  // font beats a permanently blank screen.
  if (!fontsLoaded && !fontError) return <View style={s.boot} />;

  return (
    <GestureHandlerRootView style={s.flex}>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
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
