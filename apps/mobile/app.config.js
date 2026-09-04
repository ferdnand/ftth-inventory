// Expo app config.
//
// Kept as JS rather than app.json so the dark palette can be read from one
// place — the same hex values the mockup defines.
const BG = '#0E1420';
const TEAL = '#2DD4BF';

module.exports = {
  expo: {
    name: 'FTTH Field',
    slug: 'ftth-field',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'ftthfield',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    backgroundColor: BG,
    splash: {
      backgroundColor: BG,
      resizeMode: 'contain',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'local.ftth.field',
    },
    android: {
      package: 'local.ftth.field',
      adaptiveIcon: { backgroundColor: BG },
      // Expo Go on a LAN talks plain HTTP to the dev API. Android blocks
      // cleartext by default from API 28 up.
      usesCleartextTraffic: true,
    },
    plugins: ['expo-router', 'expo-secure-store', 'expo-font'],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      accent: TEAL,
    },
  },
};
