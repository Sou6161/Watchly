/**
 * Watchly design tokens. "Cozy, evening, slightly playful" — cinema curtains.
 * Everything visual should come from here; no ad-hoc hex codes in screens.
 */

export const colors = {
  purple: '#2D1B4E',
  red: '#E94560',
  gold: '#F5D547',

  bgTop: '#1A0F2E',
  bgBottom: '#0D0418',

  text: '#FFF5E1',
  /** Warm white at reduced emphasis — for labels, helper copy, placeholders. */
  textMuted: 'rgba(255, 245, 225, 0.62)',
  textFaint: 'rgba(255, 245, 225, 0.38)',

  /** Surfaces that sit on top of the gradient (inputs, cards, chips). */
  surface: 'rgba(255, 245, 225, 0.06)',
  surfaceActive: 'rgba(233, 69, 96, 0.16)',
  border: 'rgba(255, 245, 225, 0.12)',
  borderActive: '#E94560',

  danger: '#FF6B6B',
} as const;

/** The full-screen background gradient, top to bottom. */
export const bgGradient = [colors.bgTop, colors.bgBottom] as const;

export const radii = {
  sm: 10,
  md: 16,
  /** Spec: cards are 24px. */
  card: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Fraunces (headers) + Plus Jakarta Sans (everything else). Both loaded in
 * app/_layout.tsx.
 *
 * Chosen for who this app is actually for: two people (or a group of friends)
 * deciding on a movie night together. Fraunces is a warm, slightly soft serif —
 * it reads as a film title card without tipping into the stiff, formal register
 * of something like Playfair, which suits couples AND a friend group equally
 * well. Plus Jakarta Sans is a rounded, humanist sans built for exactly this kind
 * of social, lifestyle-facing product — friendlier and less "corporate SaaS
 * dashboard" than the Inter/system-font default almost everything else reaches
 * for.
 */
export const fonts = {
  display: 'Fraunces_600SemiBold',
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemi: 'PlusJakartaSans_600SemiBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  button: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
} as const;

/** Spec: soft red glow on cards. iOS reads shadow*, Android only reads elevation. */
export const glow = {
  shadowColor: colors.red,
  shadowOpacity: 0.15,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 0 },
  elevation: 8,
} as const;
