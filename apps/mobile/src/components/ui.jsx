import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme';
import { label as toLabel } from '../lib/constants';

// The component system from mockups/mobile_screens.html:109-357, ported to
// React Native. Names match the mockup's classes so the two clients stay
// recognisably one product.

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 40 },

  trace: { height: 2, width: '100%', backgroundColor: colors.teal },

  topbar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.meta,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  h1: { fontFamily: fonts.display, fontSize: 20, color: colors.text1, marginTop: 3 },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.text2, marginTop: 4 },

  sectionLabel: {
    fontFamily: fonts.display,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.meta,
    marginTop: 18,
    marginBottom: 10,
  },

  divider: { height: 1, backgroundColor: colors.tealDim, marginVertical: 14, opacity: 0.5 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  cardLow: { borderColor: colors.lowBorder },
  cardFlat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },

  itemName: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.text1 },
  itemMeta: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.text2, marginTop: 3 },

  qty: { fontFamily: fonts.monoSemi, fontSize: 18, color: colors.text1, textAlign: 'right' },
  qtyUnit: { fontFamily: fonts.body, fontSize: 10, color: colors.meta, textAlign: 'right' },

  statRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
  },
  statWarn: { borderColor: colors.lowBorder },
  statNum: { fontFamily: fonts.monoSemi, fontSize: 22, color: colors.teal },
  statNumWarn: { color: colors.amber },
  statLbl: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.text2,
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
  },
  badgeText: { fontFamily: fonts.display, fontSize: 10, letterSpacing: 0.3, color: colors.text2 },

  serialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  serialId: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 },
  serialStatus: { fontFamily: fonts.body, fontSize: 10.5, color: colors.meta, marginTop: 2 },

  btnPrimary: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14.5, color: colors.onTeal },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  btnSecondaryText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.text1 },
  btnDanger: {
    backgroundColor: 'rgba(239,69,101,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,69,101,0.35)',
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDangerText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.danger },
  btnDisabled: { opacity: 0.45 },

  field: { marginBottom: 12 },
  fieldLabel: {
    fontFamily: fonts.display,
    fontSize: 11,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
    color: colors.label,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: fonts.mono,
    fontSize: 13.5,
    color: colors.text1,
  },
  inputFocused: { borderColor: colors.teal },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.meta, marginTop: 5 },
  fieldError: { fontFamily: fonts.body, fontSize: 11, color: colors.danger, marginTop: 5 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.text1, padding: 0 },

  resultItem: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  resultItemSelected: { borderColor: colors.teal, backgroundColor: colors.selectedBg },
  resultAddr: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.text1 },
  resultId: { fontFamily: fonts.mono, fontSize: 11, color: colors.meta, marginTop: 2 },

  woChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 14,
  },
  woChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  woChipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.text2 },

  timeline: { paddingLeft: 20, position: 'relative' },
  timelineRail: {
    position: 'absolute',
    left: 5,
    top: 4,
    bottom: 4,
    width: 1,
    backgroundColor: colors.border,
  },
  timelineRailTop: {
    position: 'absolute',
    left: 5,
    top: 4,
    height: 90,
    width: 1,
    backgroundColor: colors.teal,
    opacity: 0.7,
  },
  tItem: { position: 'relative', marginBottom: 18 },
  tDot: {
    position: 'absolute',
    left: -19,
    top: 3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.teal,
  },
  tDotRemoved: { borderColor: colors.text3 },
  tDate: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.meta },
  tTitle: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.text1, marginTop: 2 },
  tMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.text2, marginTop: 3 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillActive: { borderColor: colors.teal, backgroundColor: colors.selectedBg },
  pillText: { fontFamily: fonts.display, fontSize: 12, color: colors.text2 },
  pillTextActive: { color: colors.teal },

  banner: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,69,101,0.35)',
    backgroundColor: 'rgba(239,69,101,0.1)',
    padding: 12,
    marginBottom: 12,
  },
  bannerInfo: {
    borderColor: colors.installedBorder,
    backgroundColor: 'rgba(45,212,191,0.08)',
  },
  bannerText: { fontFamily: fonts.body, fontSize: 13, color: colors.text1 },

  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 14, color: colors.text1, marginBottom: 6 },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text2,
    textAlign: 'center',
    lineHeight: 19,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});

const BADGE_VARIANTS = {
  low: { backgroundColor: colors.lowBg, borderColor: colors.lowBorder, color: colors.amber },
  ok: { backgroundColor: colors.okBg, borderColor: colors.okBorder, color: colors.success },
  installed: {
    backgroundColor: colors.installedBg,
    borderColor: colors.installedBorder,
    color: colors.teal,
  },
  danger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, color: colors.danger },
};

// Which variant a status wears, so a status looks the same on every screen.
const STATUS_VARIANT = {
  in_stock: 'ok',
  installed: 'installed',
  faulty: 'danger',
  returned: null,
  issued: null,
  retired: null,
  open: null,
  in_progress: 'installed',
  completed: 'ok',
  cancelled: 'danger',
  requested: null,
  approved: 'installed',
  fulfilled: 'ok',
  rejected: 'danger',
};

export function Badge({ value, variant, children }) {
  const resolved = variant ?? STATUS_VARIANT[value] ?? null;
  const v = resolved ? BADGE_VARIANTS[resolved] : null;
  return (
    <View style={[styles.badge, v && { backgroundColor: v.backgroundColor, borderColor: v.borderColor }]}>
      <Text style={[styles.badgeText, v && { color: v.color }]}>
        {children ?? toLabel(value)}
      </Text>
    </View>
  );
}

export function SectionLabel({ children }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Card({ low, flat, style, children }) {
  return (
    <View style={[styles.card, low && styles.cardLow, flat && styles.cardFlat, style]}>
      {children}
    </View>
  );
}

export function StatRow({ children }) {
  return <View style={styles.statRow}>{children}</View>;
}

export function Stat({ value, label, warn }) {
  return (
    <View style={[styles.stat, warn && styles.statWarn]}>
      <Text style={[styles.statNum, warn && styles.statNumWarn]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({ onPress, disabled, busy, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[styles.btnPrimary, (disabled || busy) && styles.btnDisabled]}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={colors.onTeal} />
      ) : (
        <Text style={styles.btnPrimaryText}>{children}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ onPress, disabled, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btnSecondary, disabled && styles.btnDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.btnSecondaryText}>{children}</Text>
    </Pressable>
  );
}

export function DangerButton({ onPress, disabled, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btnDanger, disabled && styles.btnDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.btnDangerText}>{children}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, children }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children ? <Text style={styles.emptyBody}>{children}</Text> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {/* Every API failure carries a sentence written for a person. */}
      <Text style={styles.emptyBody}>{error?.message ?? 'Something went wrong.'}</Text>
      {onRetry ? <SecondaryButton onPress={onRetry}>Try again</SecondaryButton> : null}
    </View>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.teal} />
      <Text style={[styles.sub, { marginTop: 10 }]}>{label}…</Text>
    </View>
  );
}

export function Banner({ tone = 'error', children }) {
  return (
    <View style={[styles.banner, tone === 'info' && styles.bannerInfo]}>
      <Text style={styles.bannerText}>{children}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function WorkOrderChip({ children, onPress, selected }) {
  const content = (
    <View style={[styles.woChip, selected && { borderColor: colors.teal }]}>
      <View style={styles.woChipDot} />
      <Text style={styles.woChipText}>{children}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export function Pill({ active, onPress, children }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{children}</Text>
    </Pressable>
  );
}
