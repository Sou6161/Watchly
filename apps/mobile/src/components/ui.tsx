import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bgGradient, colors, glow, radii, spacing, type } from '../theme';

/** Full-screen warm gradient backdrop. Every screen sits inside one of these. */
export function Screen({ children, style, ...rest }: ViewProps) {
  return (
    <LinearGradient colors={bgGradient} style={s.gradient}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={[s.screen, style]} {...rest}>
          {children}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

export function Subheading({ children }: { children: React.ReactNode }) {
  return <Text style={s.subheading}>{children}</Text>;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        s.button,
        variant === 'primary' ? s.buttonPrimary : s.buttonGhost,
        variant === 'primary' && glow,
        pressed && s.buttonPressed,
        inert && s.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[s.buttonLabel, variant === 'ghost' && s.buttonLabelGhost]}>{label}</Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(({ label, error, ...rest }, ref) => (
  <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textFaint}
      style={[s.input, !!error && s.inputError]}
      {...rest}
    />
    {!!error && <Text style={s.fieldError}>{error}</Text>}
  </View>
));
Field.displayName = 'Field';

/** Toggleable chip — used for streaming services and region. */
export function Chip({
  label,
  selected,
  onPress,
  accent,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accent?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        s.chip,
        selected && s.chipSelected,
        selected && accent ? { borderColor: accent } : null,
        pressed && s.buttonPressed,
      ]}
    >
      {!!accent && <View style={[s.chipDot, { backgroundColor: accent }]} />}
      <Text style={[s.chipLabel, selected && s.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

/** Form-level error (bad credentials, network down) — distinct from field errors. */
export function FormError({ message }: { message: string }) {
  return (
    <View style={s.formError}>
      <Text style={s.formErrorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: spacing.lg },

  heading: { ...type.hero, color: colors.text },
  subheading: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },

  button: {
    height: 54,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonPrimary: { backgroundColor: colors.red },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { ...type.button, color: colors.text },
  buttonLabelGhost: { color: colors.textMuted },

  field: { marginBottom: spacing.md },
  fieldLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.sm },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { ...type.caption, color: colors.danger, marginTop: spacing.xs },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.surfaceActive, borderColor: colors.borderActive },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipLabel: { ...type.label, color: colors.textMuted },
  chipLabelSelected: { color: colors.text },

  formError: {
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  formErrorText: { ...type.caption, color: colors.danger },
});
