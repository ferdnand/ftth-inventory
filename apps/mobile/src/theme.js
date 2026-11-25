// Design tokens, ported verbatim from mockups/mobile_screens.html:9-22.
// Do not re-pick these — the mockup is the source of truth for the palette.
//
// React Native has no CSS custom properties, so this is a plain module consumed
// through StyleSheet.create at module scope.
//
// One deliberate deviation, the same one the web client makes: text3 (#5A6478)
// measures 2.77:1 on `surface` and 2.42:1 on `surface2`, below the 4.5:1 needed
// for normal text. The mockup uses it for form labels, serial statuses and
// timeline dates — text a tech has to read on a phone screen in daylight.
// Anything load-bearing uses `label`/`meta` (which point at text2, 5.52:1);
// text3 stays for genuinely decorative text.
export const colors = {
  // LIGHT THEME — mirrors apps/web/src/styles/tokens.css. Colours used as text
  // were re-picked to clear 4.5:1 on white; the original dark mockup values no
  // longer apply.
  bg: '#F3F5F9',
  surface: '#FFFFFF',
  surface2: '#EAEEF5',
  border: '#D5DCE8',
  teal: '#0F766E',
  tealDim: '#7CC7BF',
  amber: '#B45309',
  danger: '#C81E45',
  success: '#047857',
  text1: '#172033',
  text2: '#55607A',
  text3: '#8A94A8',

  // Semantic aliases
  label: '#55607A',
  meta: '#55607A',
  decorative: '#8A94A8',

  // Translucent fills for badges: the text colour at low opacity
  lowBg: 'rgba(180,83,9,0.12)',
  lowBorder: 'rgba(180,83,9,0.35)',
  okBg: 'rgba(4,120,87,0.1)',
  okBorder: 'rgba(4,120,87,0.3)',
  installedBg: 'rgba(15,118,110,0.1)',
  installedBorder: 'rgba(15,118,110,0.3)',
  dangerBg: 'rgba(200,30,69,0.1)',
  dangerBorder: 'rgba(200,30,69,0.3)',
  selectedBg: 'rgba(15,118,110,0.06)',
  onTeal: '#FFFFFF',
};

export const fonts = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoSemi: 'IBMPlexMono_600SemiBold',
};

export const radius = {
  sm: 10,
  md: 12,
  lg: 14,
  pill: 20,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
};
