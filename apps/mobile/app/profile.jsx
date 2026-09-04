import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { Screen } from '../src/components/Screen';
import {
  Badge,
  Card,
  DangerButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../src/components/ui';
import { API_BASE_URL, API_SOURCE, APP_VERSION } from '../src/lib/config';
import { label } from '../src/lib/constants';
import { colors, fonts } from '../src/theme';

function Row({ label: rowLabel, value, mono }) {
  return (
    <View style={styles.serialRow}>
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.text2 }}>
        {rowLabel}
      </Text>
      <Text
        style={{
          fontFamily: mono ? fonts.mono : fonts.bodySemi,
          fontSize: mono ? 11.5 : 13,
          color: colors.text1,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value ?? '—'}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <Screen eyebrow="Account" title={user?.name ?? 'Profile'} sub={user?.email}>
      <SectionLabel>Me</SectionLabel>
      <Card>
        <View style={styles.serialRow}>
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.text2 }}>
            Role
          </Text>
          <Badge value={user?.role}>{label(user?.role)}</Badge>
        </View>
        <Row label="Assigned van" value={user?.assigned_location_name} />
      </Card>

      {!user?.assigned_location_id ? (
        <Text style={styles.hint}>
          You have no assigned van, so your stock screen will be empty and you cannot move stock.
          Ask a manager to assign you one on the dashboard.
        </Text>
      ) : null}

      {/* This block is a real diagnostic, not decoration. On a physical device
        * an unreachable API is almost always the host, not the server — and if
        * this says localhost, the phone is trying to reach itself. */}
      <SectionLabel>Connection</SectionLabel>
      <Card>
        <Row label="API" value={API_BASE_URL} mono />
        <Row label="Resolved" value={API_SOURCE} />
        <Row label="App version" value={APP_VERSION} />
      </Card>
      <Text style={styles.hint}>
        If the app cannot reach the API, open{' '}
        <Text style={{ fontFamily: fonts.mono }}>{API_BASE_URL}/health</Text> in this phone’s
        browser. If that fails too, the phone is not on the same network as the dev machine — a
        tunnel is not the fix, the address is.
      </Text>

      <DangerButton onPress={signOut}>Sign out</DangerButton>
      <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
    </Screen>
  );
}
