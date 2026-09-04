import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthProvider';
import {
  useCurrentInstallation,
  usePremisesHistory,
  useReplaceRouter,
  useStock,
  useWorkOrders,
} from '../../../src/api/queries';
import { newIdempotencyKey } from '../../../src/api/client';
import { Screen } from '../../../src/components/Screen';
import { SerialPicker } from '../../../src/components/SerialPicker';
import { ReadOnlyField } from '../../../src/components/fields';
import {
  Badge,
  Banner,
  Card,
  DangerButton,
  Loading,
  Pill,
  PrimaryButton,
  SectionLabel,
  styles,
} from '../../../src/components/ui';
import { formatDate, formatPremisesCode } from '../../../src/lib/format';
import { REMOVAL_REASONS, REMOVAL_REASON_LABELS, label } from '../../../src/lib/constants';

// Mockup screen 02, lower half.
export default function ReplaceRouterScreen() {
  const { id } = useLocalSearchParams();
  const premisesId = Number(id);
  const router = useRouter();
  const { user } = useAuth();

  const current = useCurrentInstallation(premisesId);
  const history = usePremisesHistory(premisesId);
  const stock = useStock(user?.assigned_location_id);
  const jobs = useWorkOrders({ assigned_tech_id: 'me', customer_premises_id: premisesId });
  const replace = useReplaceRouter();

  const [unit, setUnit] = useState(null);
  const [reason, setReason] = useState(null);
  const [workOrderId, setWorkOrderId] = useState(null);
  const [error, setError] = useState(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  if (current.isPending || stock.isPending) return <Loading label="Loading" />;

  const address = history.data?.premises?.address ?? `Premises ${premisesId}`;

  // The API 404s here when nothing is installed. Rather than showing that as an
  // error, route to the action that does apply.
  if (current.data == null) {
    return (
      <Screen eyebrow={formatPremisesCode(premisesId)} title="Replace router" sub={address}>
        <Banner tone="info">
          There is no active router at this address, so there is nothing to replace.
        </Banner>
        <PrimaryButton onPress={() => router.replace(`/premises/${premisesId}/install`)}>
          Install one instead
        </PrimaryButton>
        <DangerButton onPress={() => router.back()}>Cancel</DangerButton>
      </Screen>
    );
  }

  async function onSubmit() {
    setError(null);
    try {
      await replace.mutateAsync({
        premisesId,
        new_item_instance_id: unit.id,
        removal_reason: reason,
        work_order_id: workOrderId ?? undefined,
        idempotency_key: idempotencyKey,
      });
      router.replace(`/premises/${premisesId}`);
    } catch (err) {
      setError(err);
    }
  }

  const ready = Boolean(unit && reason);

  return (
    <Screen eyebrow={formatPremisesCode(premisesId)} title="Replace router" sub={address}>
      {error ? <Banner>{error.message}</Banner> : null}

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

      <SectionLabel>Currently installed</SectionLabel>
      <Card flat>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName}>{current.data.item_name}</Text>
          <Text style={styles.itemMeta}>{current.data.serial_number}</Text>
          <Text style={styles.itemMeta}>{current.data.mac_address ?? 'no MAC recorded'}</Text>
          <Text style={[styles.serialStatus, { marginTop: 4 }]}>
            Installed {formatDate(current.data.installed_at)}
          </Text>
        </View>
        <Badge variant="installed">Active</Badge>
      </Card>

      <SectionLabel>Replace with</SectionLabel>
      {/* The mockup has free-text serial and MAC inputs here, but the API needs
        * an item_instance_id and nothing turns an arbitrary typed serial into
        * one. So this is a filter over the van's own units: type or scan a
        * serial to narrow it, tap to select. Same interaction, honest about the
        * rule — you can only install a unit you are actually carrying. */}
      <SerialPicker rows={stock.data?.serialized ?? []} selectedId={unit?.id} onSelect={setUnit} />

      {unit ? (
        // Read-only, because item_instances already holds the MAC against that
        // serial. Making the tech retype it would only create a way to get it
        // wrong.
        <ReadOnlyField
          label="MAC address"
          value={unit.mac_address}
          hint="Read from the unit's record — no need to type it."
        />
      ) : null}

      <SectionLabel>Reason for removal</SectionLabel>
      <View style={styles.pillRow}>
        {REMOVAL_REASONS.map((value) => (
          <Pill key={value} active={reason === value} onPress={() => setReason(value)}>
            {REMOVAL_REASON_LABELS[value]}
          </Pill>
        ))}
      </View>
      <Text style={[styles.hint, { marginTop: 8 }]}>
        Required to complete a replacement. The database enforces it too, so a removal can never be
        recorded without one.
      </Text>

      {reason === 'faulty' ? (
        <Text style={[styles.hint, { marginTop: 4 }]}>
          The removed unit will be marked faulty and stay in your van until you run it back to the
          warehouse.
        </Text>
      ) : reason ? (
        <Text style={[styles.hint, { marginTop: 4 }]}>
          The removed unit will be marked returned and stay in your van until you run it back.
        </Text>
      ) : null}

      <PrimaryButton onPress={onSubmit} disabled={!ready} busy={replace.isPending}>
        Confirm replacement
      </PrimaryButton>
      <DangerButton onPress={() => router.back()} disabled={replace.isPending}>
        Cancel
      </DangerButton>
    </Screen>
  );
}
