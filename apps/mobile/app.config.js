// Expo app config.
//
// Kept as JS rather than app.json so the palette can be read from one
// place — the same hex values the mockup defines.
const BG = '#F3F5F9';
const TEAL = '#0F766E';

module.exports = {
  expo: {
    name: 'FTTH Field',
    slug: 'ftth-field',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'ftthfield',
    userInterfaceStyle: 'light',
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
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-font',
      // Foreground location only. The app asks for a fix when the tech taps
      // "use my location" and at no other time — there is no tracking here,
      // and asking for background access would be asking for something the app
      // does not use.
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'FTTH Field uses your location to pin customer premises, because the ' +
            'villages it serves have no street addresses.',
          locationWhenInUsePermission:
            'FTTH Field uses your location to pin customer premises, because the ' +
            'villages it serves have no street addresses.',
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      accent: TEAL,
    },
  },
};
