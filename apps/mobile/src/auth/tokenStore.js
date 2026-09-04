import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Token storage.
//
// On a device: expo-secure-store, so the token goes in the iOS Keychain or
// Android EncryptedSharedPreferences — not readable from a backup or by another
// app.
//
// On web: expo-secure-store is native-only and throws, so fall back to
// localStorage. That is the same (weaker) storage the dashboard uses, and it is
// what makes `expo start --web` usable for a demo or a quick check. A real
// deployment of this app is the native build, where the Keychain path applies.
//
// Everything here is ASYNC — that is the difference from the dashboard's
// synchronous localStorage, and it is why the API client has to await the token
// rather than reading it inline.
const KEY = 'ftth.token';

const isWeb = Platform.OS === 'web';

export async function getToken() {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // A device with no secure hardware, or a keychain the OS refuses. Treat it
    // as "not signed in" rather than crashing on launch.
    return null;
  }
}

export async function setToken(token) {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, token);
    else await SecureStore.setItemAsync(KEY, token);
  } catch {
    /* the session lasts until the app is closed */
  }
}

export async function clearToken() {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* nothing to do */
  }
}
