import { Platform } from 'react-native';
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

// The API's PORT is per-machine (4000 is taken on some dev machines, see
// PROCESS.md §3), so the derived URL must not hardcode it.
const apiPort = process.env.EXPO_PUBLIC_API_PORT || '4000';

// On the web (the PWA) there is no Metro host in the config, but the page itself
// is served from the dev machine, so its own hostname plays the same role. A
// production web build is served from the API's own origin (or a proxy that
// forwards /api to it), so a relative /api is right and survives a domain
// change. Anything else sets EXPO_PUBLIC_API_URL when building.
const isWeb = Platform.OS === 'web';
const webDevHost = isWeb && __DEV__ ? globalThis.location?.hostname : null;

function resolveApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (isWeb) {
    return webDevHost ? `http://${webDevHost}:${apiPort}/api` : '/api';
  }
  return derivedHost
    ? `http://${derivedHost}:${apiPort}/api`
    : `http://localhost:${apiPort}/api`;
}

export const API_BASE_URL = resolveApiBaseUrl();

// Shown on the profile screen. When the app cannot reach the API, this is the
// first thing to look at — and the first debugging step is opening
// <that host>/api/health in the PHONE's browser, not the laptop's.
export const API_SOURCE = process.env.EXPO_PUBLIC_API_URL
  ? 'EXPO_PUBLIC_API_URL'
  : isWeb
    ? webDevHost
      ? 'derived from the page host'
      : 'same origin as the app (/api)'
    : derivedHost
    ? 'derived from the Metro host'
    : 'fallback (localhost — will not work on a physical device)';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
