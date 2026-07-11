import { View, StyleSheet } from 'react-native';
import { colors } from '../src/theme';

/**
 * The root route renders nothing on purpose: useProtectedRoute in _layout.tsx
 * redirects to /auth/login, /onboarding, or /home as soon as auth resolves. This
 * just holds the background so there's no white flash in between.
 */
export default function Index() {
  return <View style={s.blank} />;
}

const s = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bgTop },
});
