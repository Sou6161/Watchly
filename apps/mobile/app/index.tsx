import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthLoading, useUser } from '../src/stores/auth';
import { colors } from '../src/theme';

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
