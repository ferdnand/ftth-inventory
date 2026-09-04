import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useCreatePremises } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/fields';
import { Banner, PrimaryButton, SecondaryButton, styles } from '../../src/components/ui';
import { Text } from 'react-native';

// A tech standing at a new address needs to be able to create it before they
// can install anything there, so POST /api/premises is open to any
// authenticated user rather than warehouse staff only.
export default function NewPremisesScreen() {
  const router = useRouter();
  const create = useCreatePremises();

  const [address, setAddress] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState(null);

  async function onSubmit() {
    setError(null);
    if (!address.trim()) {
      setError({ message: 'An address is required' });
      return;
    }
    try {
      const { premises } = await create.mutateAsync({
        address: address.trim(),
        customer_account_id: accountId.trim() || undefined,
      });
      router.replace(`/premises/${premises.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen eyebrow="Field work" title="Add premises" sub="A new customer address">
      {error ? <Banner>{error.message}</Banner> : null}

      <TextField
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="14B Ngong Road, Nairobi"
        autoCapitalize="words"
      />
      <TextField
        label="Customer account"
        value={accountId}
        onChangeText={setAccountId}
        placeholder="KE-77291"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Text style={styles.hint}>
        If the customer has a reference from billing, put it here — that is what makes the address
        findable by account number.
      </Text>

      <PrimaryButton onPress={onSubmit} busy={create.isPending} disabled={!address.trim()}>
        Add premises
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={create.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
