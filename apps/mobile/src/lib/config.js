import Constants from 'expo-constants';

// The single highest-probability time sink in a React Native project:
// `localhost` on the phone IS the phone. Pointing the app at
// http://localhost:4000 gets a connection refused, every time, and it looks
// like an API bug.
//
// The fix removes the manual step entirely: in Expo Go the Metro host is the
// dev machine's LAN IP, so derive the API host from it. This self-heals when
// DHCP hands out a new address or you move between networks — no .env edit and
// no rebuild.
function metroHost() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    Constants.manifest2?.extra?.expoGo?.debuggerHost ??
    null;
  return hostUri ? hostUri.split(':')[0] : null;
}

const derivedHost = metroHost();

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (derivedHost ? `http://${derivedHost}:4000/api` : 'http://localhost:4000/api');

// Shown on the profile screen. When the app cannot reach the API, this is the
// first thing to look at — and the first debugging step is opening
// <that host>/api/health in the PHONE's browser, not the laptop's.
export const API_SOURCE = process.env.EXPO_PUBLIC_API_URL
  ? 'EXPO_PUBLIC_API_URL'
  : derivedHost
    ? 'derived from the Metro host'
    : 'fallback (localhost — will not work on a physical device)';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
