import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { TextField } from '../src/components/fields';
import { Banner, PrimaryButton, styles } from '../src/components/ui';
import { API_BASE_URL } from '../src/lib/config';
import { colors, fonts } from '../src/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // AuthGate does the redirect once `isAuthenticated` flips.
    } catch (err) {
      // The API returns one message for a wrong email and a wrong password
      // alike, on purpose. Showing it verbatim keeps that property.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.trace} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 24 }}
      >
        <Text style={styles.eyebrow}>FTTH field inventory</Text>
        <Text style={[styles.h1, { fontSize: 26, marginBottom: 4 }]}>Sign in</Text>
        <Text style={[styles.sub, { marginBottom: 22 }]}>
          Your van’s stock and your jobs for today
        </Text>

        {error ? <Banner>{error}</Banner> : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@ftth.local"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          keyboardType="email-address"
          textContentType="username"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        <PrimaryButton onPress={onSubmit} busy={busy} disabled={!email || !password}>
          Sign in
        </PrimaryButton>

        {/* The single most useful diagnostic on a physical device: if this says
          * localhost, the phone is trying to reach itself. */}
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10.5,
            color: colors.decorative,
            marginTop: 24,
            textAlign: 'center',
          }}
        >
          API {API_BASE_URL}
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}
