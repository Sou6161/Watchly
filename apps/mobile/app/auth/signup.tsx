import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { checkPassword } from '@watchly/shared';
import { Button, Field, FormError, Heading, Screen, Subheading } from '../../src/components/ui';
import { useAuthStore } from '../../src/stores/auth';
import { ApiError } from '../../src/lib/api';
import { colors, spacing, type } from '../../src/theme';

export default function Signup() {
  const signup = useAuthStore((s) => s.signup);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await signup({ email: email.trim(), password, displayName: displayName.trim() });
      // useProtectedRoute sends a brand-new user straight to /onboarding.
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        if (e.fields) setFields(e.fields);
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Same rule the server enforces, run locally so a weak password shows up while
  // typing rather than after a round trip. The server check is the real control;
  // this is only courtesy.
  const pwCheck = checkPassword(password, email.trim());
  const showPwProblem = password.length > 0 && !pwCheck.ok;

  const ready = displayName.trim().length > 0 && email.trim().length > 0 && pwCheck.ok;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <View style={s.header}>
          <Heading>Movie night, sorted.</Heading>
          <Subheading>Swipe together. Watch what you both said yes to.</Subheading>
        </View>

        {!!error && <FormError message={error} />}

        <Field
          label="Your name"
          value={displayName}
          onChangeText={setDisplayName}
          error={fields.displayName}
          placeholder="Sourabh"
          autoComplete="name"
          returnKeyType="next"
        />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fields.email}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fields.password ?? (showPwProblem ? pwCheck.message : undefined)}
          secureTextEntry
          autoComplete="new-password"
          placeholder="At least 8 characters"
          returnKeyType="go"
          onSubmitEditing={submit}
        />

        <View style={s.actions}>
          <Button label="Create account" onPress={submit} loading={busy} disabled={!ready} />
          <Link href="/auth/login" asChild>
            <Pressable style={s.link}>
              <Text style={s.linkText}>
                Already have an account? <Text style={s.linkAccent}>Sign in</Text>
              </Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'center' },
  header: { marginBottom: spacing.xl },
  actions: { marginTop: spacing.md, gap: spacing.md },
  link: { alignItems: 'center', paddingVertical: spacing.sm },
  linkText: { ...type.body, color: colors.textMuted },
  linkAccent: { color: colors.red },
});
