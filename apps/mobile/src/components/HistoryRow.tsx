import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { moodById, type SessionSummary } from '@watchly/shared';
import { colors, radii, spacing, type } from '../theme';

/** One night in the history — a poster stack, who it was with, and how it went. */
export function HistoryRow({
  session,
  onPress,
}: {
  session: SessionSummary;
  onPress: () => void;
}) {
  const mood = session.mood ? moodById(session.mood) : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      {/* A little stack of the matched posters — the fastest way to recognise a
          night you half-remember. */}
      <View style={s.stack}>
        {session.matchPosters.length > 0 ? (
          session.matchPosters.map((uri, i) => (
            <Image
              key={uri}
              source={{ uri }}
              style={[s.stackPoster, { left: i * 14, zIndex: 3 - i }]}
              resizeMode="cover"
            />
          ))
        ) : (
          <View style={[s.stackPoster, s.stackEmpty]} />
        )}
      </View>

      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {session.matchCount > 0
            ? `${session.matchCount} match${session.matchCount === 1 ? '' : 'es'} with ${session.partnerLabel}`
            : `No overlap with ${session.partnerLabel}`}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[
            session.titleType === 'TV' ? '📺' : '🎬',
            mood && `${mood.emoji} ${mood.label}`,
            formatWhen(session.completedAt),
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      </View>

      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

/** Relative for the recent past, absolute once it stops being "the other night". */
export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);

  if (days <= 0) return 'Tonight';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    // Opaque, not translucent — Android renders elevation/borders against the
    // backing rect and a see-through fill leaks a pale box past the corners.
    backgroundColor: '#241640',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  rowPressed: { opacity: 0.8 },
  stack: { width: 68, height: 54, justifyContent: 'center' },
  stackPoster: {
    position: 'absolute',
    width: 36,
    height: 54,
    borderRadius: 4,
    backgroundColor: colors.purple,
    borderWidth: 1,
    borderColor: colors.bgBottom,
  },
  stackEmpty: { opacity: 0.4 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.label, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  chevron: { ...type.title, color: colors.textFaint },
});
