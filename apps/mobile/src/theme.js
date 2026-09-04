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
  bg: '#0E1420',
  surface: '#171F2E',
  surface2: '#1F2A3D',
  border: '#28334A',
  teal: '#2DD4BF',
  tealDim: '#1B7A70',
  amber: '#F5A623',
  danger: '#EF4565',
  success: '#34D399',
  text1: '#EDF1F7',
  text2: '#8B96A8',
  text3: '#5A6478',

  // Semantic aliases
  label: '#8B96A8',
  meta: '#8B96A8',
  decorative: '#5A6478',

  // Translucent fills, taken from the mockup's badge rules
  lowBg: 'rgba(245,166,35,0.15)',
  lowBorder: 'rgba(245,166,35,0.35)',
  okBg: 'rgba(52,211,153,0.12)',
  okBorder: 'rgba(52,211,153,0.3)',
  installedBg: 'rgba(45,212,191,0.12)',
  installedBorder: 'rgba(45,212,191,0.3)',
  dangerBg: 'rgba(239,69,101,0.12)',
  dangerBorder: 'rgba(239,69,101,0.3)',
  selectedBg: 'rgba(45,212,191,0.06)',
  onTeal: '#04141A',
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
