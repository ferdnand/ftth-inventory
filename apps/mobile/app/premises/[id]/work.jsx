import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthProvider';
import {
  useCurrentInstallation,
  usePremisesHistory,
  useServices,
  useSetInstallationServices,
} from '../../../src/api/queries';
import { Screen } from '../../../src/components/Screen';
import {
  ServicePicker,
  serviceLinesReady,
  toServiceLines,
} from '../../../src/components/ServicePicker';
import {
  Banner,
  EmptyState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../../src/components/ui';
import { formatPremisesCode } from '../../../src/lib/format';

// Amends the labour recorded against the router currently installed here —
// work remembered on the drive home, or a cable length typed wrong.
//
// The API only lets a tech edit an installation they performed themselves, and
// only while it is still the active one. Both are enforced there; this screen
// just avoids offering the action when it would obviously fail.
export default function RecordWorkScreen() {
  const { id } = useLocalSearchParams();
  const premisesId = Number(id);
  const router = useRouter();
  const { user } = useAuth();

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);
  const services = useServices();
  const save = useSetInstallationServices();

  const [work, setWork] = useState(null);
  const [error, setError] = useState(null);

  if (current.isPending || services.isPending) return <Loading label="Loading" />;

  const address = history.data?.premises?.address ?? `Premises ${premisesId}`;
  const installation = current.data;

  if (!installation) {
    return (
      <Screen eyebrow={formatPremisesCode(premisesId)} title="Record work" sub={address}>
        <EmptyState title="Nothing is installed here">
          Work is recorded against an installation, so there is nothing to attach it to yet.
        </EmptyState>
        <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
      </Screen>
    );
  }

  // Seed the picker from what is already recorded, so saving is an edit rather
  // than a fresh start that would silently wipe the existing lines.
  const value =
    work ??
    Object.fromEntries(
      (installation.services ?? []).map((line) => [
        line.service_id,
        { quantity: String(line.quantity), notes: line.notes ?? '' },
      ])
    );

  async function onSubmit() {
    setError(null);
    try {
      await save.mutateAsync({
        installationId: installation.installation_id,
        premisesId,
        services: toServiceLines(value),
      });
      router.replace(`/premises/${premisesId}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={formatPremisesCode(premisesId)}
      title="Record work"
      sub={`${installation.item_name} · ${installation.serial_number}`}
    >
      {error ? <Banner>{error.message}</Banner> : null}

      <SectionLabel>Work performed at this address</SectionLabel>
      <ServicePicker services={services.data ?? []} value={value} onChange={setWork} />

      <PrimaryButton
        onPress={onSubmit}
        disabled={!serviceLinesReady(value, services.data)}
        busy={save.isPending}
      >
        Save recorded work
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={save.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
