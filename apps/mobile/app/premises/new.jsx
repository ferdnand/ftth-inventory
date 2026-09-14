import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useCreatePremises, useSites } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import {
  PremisesForm,
  emptyPremises,
  premisesLocatable,
  toPremisesBody,
} from '../../src/components/PremisesForm';
import { Banner, PrimaryButton, SecondaryButton, styles } from '../../src/components/ui';

// Capturing a premises on its own, with no job attached.
//
// The usual path is "Start a job", which captures the place and opens the job in
// one submit — a tech standing in a compound wants one button, not two screens.
// This exists for the survey case: walking a village and writing down what is
// there, to be connected later.
//
// POST /api/premises is open to any authenticated user for exactly this reason.
export default function NewPremisesScreen() {
  const router = useRouter();
  const create = useCreatePremises();
  const sites = useSites();

  const [value, setValue] = useState(emptyPremises);
  const [gps, setGps] = useState(null);
  const [error, setError] = useState(null);

  async function onSubmit() {
    setError(null);
    try {
      const { premises } = await create.mutateAsync(toPremisesBody(value, gps));
      router.replace(`/premises/${premises.id}`);
    } catch (err) {
      setError(err);
    }
  }

  const ready = premisesLocatable(value, gps);

  return (
    <Screen
      eyebrow="Field work"
      title="Add a premises"
      sub="Somewhere to come back to later"
    >
      {error ? <Banner>{error.message}</Banner> : null}

      <PremisesForm
        value={value}
        onChange={setValue}
        gps={gps}
        onGpsChange={setGps}
        sites={sites.data ?? []}
      />

      {!ready ? (
        <Text style={styles.hint}>
          Take a GPS fix, or give a landmark or an address, before saving.
        </Text>
      ) : null}

      <PrimaryButton onPress={onSubmit} busy={create.isPending} disabled={!ready}>
        Save premises
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={create.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
