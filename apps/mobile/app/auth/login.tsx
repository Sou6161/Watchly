import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Button, Field, FormError, Heading, Screen, Subheading } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth-context';
import { ApiError } from '../../src/lib/api';
import { colors, spacing, type } from '../../src/theme';

export default function Login() {
  const { login } = useAuth();
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
      await login({ email: email.trim(), password });
      // No navigation here — useProtectedRoute redirects once `user` is set.
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

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <View style={s.header}>
          <Heading>Welcome back</Heading>
          <Subheading>Let&apos;s find something you both want to watch.</Subheading>
        </View>

        {!!error && <FormError message={error} />}

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
          error={fields.password}
          secureTextEntry
          autoComplete="current-password"
          placeholder="••••••••"
          returnKeyType="go"
          onSubmitEditing={submit}
        />

        <View style={s.actions}>
          <Button
            label="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!email.trim() || !password}
          />
          <Link href="/auth/signup" asChild>
            <Pressable style={s.link}>
              <Text style={s.linkText}>
                New here? <Text style={s.linkAccent}>Create an account</Text>
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
