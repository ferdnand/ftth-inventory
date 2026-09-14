import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useJob, useSetJobMaterials, useStock } from '../../../src/api/queries';
import { Screen } from '../../../src/components/Screen';
import {
  MaterialPicker,
  fromMaterialLines,
  materialLinesReady,
  recordedQuantities,
  toMaterialLines,
} from '../../../src/components/MaterialPicker';
import {
  Banner,
  EmptyState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../../src/components/ui';

// What went into this job, out of the van.
//
// The list is complete rather than additive: what the tech leaves here is what
// the job used, and the API moves stock by the difference. That is what makes a
// second tap on a dying connection harmless, and it is also why the picker is
// seeded from what is already recorded — starting blank would look like an edit
// and silently put every material back in the van.
export default function JobMaterialsScreen() {
  const { id } = useLocalSearchParams();
  const jobId = Number(id);
  const router = useRouter();
  const { user } = useAuth();

  const job = useJob(jobId);
  const stock = useStock(user?.assigned_location_id);
  const save = useSetJobMaterials();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  if (job.isPending || stock.isPending) return <Loading label="Loading your van" />;

  if (!user?.assigned_location_id) {
    return (
      <Screen eyebrow={`Job #${jobId}`} title="Materials">
        <EmptyState title="You have no van assigned">
          Materials come out of your own stock, so a manager has to assign you to a van before you
          can record any.
        </EmptyState>
        <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
      </Screen>
    );
  }

  const recorded = job.data?.materials ?? [];
  const value = draft ?? fromMaterialLines(recorded);
  const already = recordedQuantities(recorded);
  const bulk = stock.data?.bulk ?? [];

  async function onSubmit() {
    setError(null);
    try {
      await save.mutateAsync({ jobId, materials: toMaterialLines(value) });
      router.replace(`/jobs/${jobId}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={`Job #${jobId}`}
      title="Materials used"
      sub={job.data?.label}
    >
      {error ? <Banner>{error.message}</Banner> : null}

      <SectionLabel>Out of your van</SectionLabel>
      <MaterialPicker stock={bulk} recorded={already} value={value} onChange={setDraft} />

      <Text style={styles.hint}>
        Saving takes these out of your van. Change a number later and only the difference moves —
        put a line back to nothing and the whole lot returns.
      </Text>

      <PrimaryButton
        onPress={onSubmit}
        disabled={!materialLinesReady(value, bulk, already)}
        busy={save.isPending}
      >
        Save materials
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={save.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
