import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useJob, useServices, useSetJobServices } from '../../../src/api/queries';
import { Screen } from '../../../src/components/Screen';
import {
  ServicePicker,
  serviceLinesReady,
  toServiceLines,
} from '../../../src/components/ServicePicker';
import {
  Banner,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../../src/components/ui';

// The labour on this visit.
//
// Recorded against the job rather than against the router, which is the point:
// a tech who drives out to re-splice a cut cable fits no hardware and has done
// a day's billable work. Under the old model that visit had nowhere to put it.
export default function JobWorkScreen() {
  const { id } = useLocalSearchParams();
  const jobId = Number(id);
  const router = useRouter();

  const job = useJob(jobId);
  const services = useServices();
  const save = useSetJobServices();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  if (job.isPending || services.isPending) return <Loading label="Loading" />;

  // Seed from what is already recorded, so saving is an edit rather than a
  // fresh start that would silently wipe the existing lines.
  const value =
    draft ??
    Object.fromEntries(
      (job.data?.services ?? []).map((line) => [
        line.service_id,
        { quantity: String(line.quantity), notes: line.notes ?? '' },
      ])
    );

  async function onSubmit() {
    setError(null);
    try {
      await save.mutateAsync({ jobId, services: toServiceLines(value) });
      router.replace(`/jobs/${jobId}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen eyebrow={`Job #${jobId}`} title="Work done" sub={job.data?.label}>
      {error ? <Banner>{error.message}</Banner> : null}

      <SectionLabel>What you did on this visit</SectionLabel>
      <ServicePicker services={services.data ?? []} value={value} onChange={setDraft} />

      <Text style={styles.hint}>
        Rates come off the catalog, so you do not have to know them. The warehouse sets them.
      </Text>

      <PrimaryButton
        onPress={onSubmit}
        disabled={!serviceLinesReady(value, services.data)}
        busy={save.isPending}
      >
        Save work done
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={save.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
