import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';

import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { ApiError } from '../src/api/client';
import { Loading } from '../src/components/ui';
import { colors } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx will not fix itself; retrying a 403 three times only delays the
      // message the tech needs to read. A network failure is worth one retry.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

// The auth gate. expo-router mounts the whole tree before this runs, so the
// redirect happens after the first frame — which is why the bootstrapping state
// renders a loader rather than falling through to the tab bar.
function AuthGate({ children }) {
  const { isBootstrapping, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isBootstrapping) return;
    const onLogin = segments[0] === 'login';

    if (!isAuthenticated && !onLogin) {
      router.replace('/login');
    } else if (isAuthenticated && onLogin) {
      router.replace('/(tabs)/stock');
    }
  }, [isBootstrapping, isAuthenticated, segments, router]);

  if (isBootstrapping) return <Loading label="Checking your session" />;
  return children;
}

// How long to wait for the custom fonts before rendering anyway.
const FONT_TIMEOUT_MS = 3000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_600SemiBold,
  });

  // Never block the app on fonts indefinitely. A font *error* is already
  // handled below, but a font load that simply never settles would leave a tech
  // staring at a blank screen with no way forward — and system fonts are a
  // perfectly usable fallback. This is the difference between degraded and
  // unusable.
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedLongEnough(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsLoaded || fontError || waitedLongEnough;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" backgroundColor={colors.bg} />
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'slide_from_right',
              }}
            />
          </AuthGate>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
