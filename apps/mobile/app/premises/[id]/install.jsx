import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthProvider';
import {
  useCurrentInstallation,
  useInstall,
  usePremisesHistory,
  useStock,
  useWorkOrders,
} from '../../../src/api/queries';
import { newIdempotencyKey } from '../../../src/api/client';
import { Screen } from '../../../src/components/Screen';
import { SerialPicker } from '../../../src/components/SerialPicker';
import {
  Banner,
  EmptyState,
  Loading,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../../src/components/ui';
import { formatPremisesCode } from '../../../src/lib/format';
import { label } from '../../../src/lib/constants';

export default function InstallAtPremisesScreen() {
  const { id } = useLocalSearchParams();
  const premisesId = Number(id);
  const router = useRouter();
  const { user } = useAuth();

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);
  const stock = useStock(user?.assigned_location_id);
  const jobs = useWorkOrders({ assigned_tech_id: 'me', customer_premises_id: premisesId });
  const install = useInstall();

  const [unit, setUnit] = useState(null);
  const [workOrderId, setWorkOrderId] = useState(null);
  const [error, setError] = useState(null);
  // One key per submit attempt, held across retries so a flaky connection
  // cannot double-install.
  const [idempotencyKey] = useState(newIdempotencyKey);

  if (history.isPending || stock.isPending) return <Loading label="Loading" />;

  const address = history.data?.premises?.address ?? `Premises ${premisesId}`;
  const alreadyInstalled = current.data != null;

  async function onSubmit() {
    setError(null);
    try {
      await install.mutateAsync({
        customer_premises_id: premisesId,
        item_instance_id: unit.id,
        work_order_id: workOrderId ?? undefined,
        idempotency_key: idempotencyKey,
      });
      router.replace(`/premises/${premisesId}`);
    } catch (err) {
      setError(err);
    }
  }

  // The 409 is a first-class path, not an error to apologise for: it means
  // someone got here first, and the right next step is a replacement.
  const isConflict = error?.status === 409;

  return (
    <Screen
      eyebrow={formatPremisesCode(premisesId)}
      title="Install router"
      sub={address}
    >
      {alreadyInstalled ? (
        <>
          <Banner>
            There is already an active router at this address. Replacing it records the removal and
            the reason, which installing again would not.
          </Banner>
          <PrimaryButton onPress={() => router.replace(`/premises/${premisesId}/replace`)}>
            Replace it instead
          </PrimaryButton>
          <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
        </>
      ) : (
        <>
          {error ? (
            <Banner>
              {error.message}
            </Banner>
          ) : null}
          {isConflict ? (
            <PrimaryButton onPress={() => router.replace(`/premises/${premisesId}/replace`)}>
              Replace instead
            </PrimaryButton>
          ) : null}

          {jobs.data?.length > 0 ? (
            <>
              <SectionLabel>Link to a job (optional)</SectionLabel>
              <View style={styles.pillRow}>
                <Pill active={workOrderId === null} onPress={() => setWorkOrderId(null)}>
                  No job
                </Pill>
                {jobs.data.map((job) => (
                  <Pill
                    key={job.id}
                    active={workOrderId === job.id}
                    onPress={() => setWorkOrderId(job.id)}
                  >
                    #{job.id} · {label(job.type)}
                  </Pill>
                ))}
              </View>
            </>
          ) : null}

          <SectionLabel>Choose a unit from your van</SectionLabel>
          <SerialPicker
            rows={stock.data?.serialized ?? []}
            selectedId={unit?.id}
            onSelect={setUnit}
          />

          {unit ? (
            <>
              <SectionLabel>Confirm</SectionLabel>
              <EmptyState title={unit.serial_number}>
                {unit.mac_address ? `MAC ${unit.mac_address}\n` : ''}
                Installing at {address}
              </EmptyState>
            </>
          ) : null}

          <PrimaryButton
            onPress={onSubmit}
            disabled={!unit}
            busy={install.isPending}
          >
            Confirm install
          </PrimaryButton>
          <SecondaryButton onPress={() => router.back()} disabled={install.isPending}>
            Cancel
          </SecondaryButton>
        </>
      )}
    </Screen>
  );
}
