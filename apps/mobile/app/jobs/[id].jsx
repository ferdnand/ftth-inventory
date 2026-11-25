import { useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useJob,
  useUpdatePremisesLocation,
  useUpdateWorkOrder,
} from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import { CostSummary } from '../../src/components/CostSummary';
import { GpsField, gpsFromPremises } from '../../src/components/GpsField';
import {
  Badge,
  Banner,
  Card,
  ErrorState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../src/components/ui';
import { formatMoney } from '../../src/lib/money';
import { formatDate, formatPremisesCode, formatQuantity } from '../../src/lib/format';
import { label } from '../../src/lib/constants';
import { colors, fonts } from '../../src/theme';

// One job, and everything it produced.
//
// This is the screen the whole change is for. Before it, a tech could record
// the router they fitted and nothing else: no cable, no splice on a visit that
// fitted no hardware, and no money at all. Each section below is one of those
// gaps, and each is a tap to a form that replaces its whole list — so a save
// that half-succeeded on a bad connection is safe to repeat.
//
// The router section links back to the premises install/replace screens rather
// than duplicating them, passing this job along so the hardware lands on it.

function Row({ title, meta, value, onPress, done }) {
  return (
    <Pressable onPress={onPress} style={styles.resultItem}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName}>{title}</Text>
          <Text style={styles.serialStatus}>{meta}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {value ? (
            <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.text1 }}>
              {value}
            </Text>
          ) : null}
          <Text style={{ fontFamily: fonts.display, fontSize: 11.5, color: colors.teal }}>
            {done ? 'Edit' : 'Add'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function JobScreen() {
  const { id } = useLocalSearchParams();
  const jobId = Number(id);
  const router = useRouter();

  const job = useJob(jobId);
  const update = useUpdateWorkOrder();
  const improveFix = useUpdatePremisesLocation();

  const [error, setError] = useState(null);
  const [fixingGps, setFixingGps] = useState(false);

  if (job.isPending) return <Loading label="Loading the job" />;
  if (job.isError) {
    return (
      <Screen title="Job">
        <ErrorState
          error={job.error}
          onRetry={job.refetch}
          title={job.error?.status === 404 ? 'No such job' : undefined}
        />
        <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
      </Screen>
    );
  }

  const data = job.data;
  const premises = data.premises;
  const materials = data.materials ?? [];
  const services = data.services ?? [];
  const expenses = data.expenses ?? [];
  const installed = (data.installations ?? []).filter((row) => !row.removed_at);
  const live = data.status === 'open' || data.status === 'in_progress';

  async function setStatus(status) {
    setError(null);
    try {
      await update.mutateAsync({ id: jobId, status });
      if (status === 'completed') router.replace('/(tabs)/jobs');
    } catch (err) {
      setError(err);
    }
  }

  async function saveFix(fix) {
    setError(null);
    try {
      await improveFix.mutateAsync({
        premisesId: premises.id,
        gps_lat: fix.lat,
        gps_lng: fix.lng,
        gps_accuracy_m: fix.accuracy ?? undefined,
        gps_captured_at: fix.capturedAt,
      });
      setFixingGps(false);
      job.refetch();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={`Job #${data.id} · ${label(data.type)}`}
      title={data.label}
      sub={[premises.village, data.site_name].filter(Boolean).join(' · ') || undefined}
      right={<Badge value={data.status} />}
      refreshControl={
        <RefreshControl
          refreshing={job.isRefetching}
          onRefresh={job.refetch}
          tintColor={colors.teal}
        />
      }
    >
      {error ? <Banner>{error.message}</Banner> : null}

      {/* --- The place ---------------------------------------------------- */}
      <SectionLabel>The premises</SectionLabel>
      <Card>
        <Text style={styles.itemName}>{premises.customer_name ?? 'No name recorded'}</Text>
        <Text style={styles.itemMeta}>
          {formatPremisesCode(premises.id)} · {label(premises.premises_type)}
        </Text>
        {premises.customer_phone ? (
          <Text style={styles.itemMeta}>{premises.customer_phone}</Text>
        ) : null}
        {premises.landmark ? (
          <Text style={[styles.serialStatus, { marginTop: 4 }]}>{premises.landmark}</Text>
        ) : null}
        <Text style={[styles.serialStatus, { marginTop: 4 }]}>
          {premises.gps_lat === null
            ? 'No GPS pin — nobody else will find this place'
            : `Pin ${premises.gps_lat.toFixed(5)}, ${premises.gps_lng.toFixed(5)}` +
              (premises.gps_accuracy_m ? ` (±${premises.gps_accuracy_m} m)` : '')}
        </Text>

        {fixingGps ? (
          <View style={{ marginTop: 10 }}>
            <GpsField
              value={gpsFromPremises(premises)}
              onChange={saveFix}
              label="Take a better fix"
              hint="Saved as soon as you get it."
            />
            <SecondaryButton onPress={() => setFixingGps(false)}>Done</SecondaryButton>
          </View>
        ) : (
          <Pressable onPress={() => setFixingGps(true)} style={{ marginTop: 10 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 12.5, color: colors.teal }}>
              {premises.gps_lat === null ? '+ Drop a GPS pin' : 'Improve the GPS pin'}
            </Text>
          </Pressable>
        )}
      </Card>

      {/* --- What was fitted ---------------------------------------------- */}
      <SectionLabel>Router</SectionLabel>
      {installed.length > 0 ? (
        installed.map((row) => (
          <Card key={row.installation_id} flat>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{row.item_name}</Text>
              <Text style={styles.itemMeta}>{row.serial_number}</Text>
              <Text style={styles.itemMeta}>{row.mac_address ?? 'no MAC recorded'}</Text>
            </View>
            <Badge variant="installed">Fitted</Badge>
          </Card>
        ))
      ) : (
        <Row
          title="No router fitted"
          meta="A repair may not need one — leave it if nothing was installed"
          done={false}
          onPress={() =>
            router.push(`/premises/${premises.id}/install?job=${jobId}`)
          }
        />
      )}
      {installed.length > 0 && live ? (
        <SecondaryButton
          onPress={() => router.push(`/premises/${premises.id}/replace?job=${jobId}`)}
        >
          Swap the router out
        </SecondaryButton>
      ) : null}
      {/* A hotspot can carry several routers, so one fitted is not the end of it. */}
      {installed.length > 0 && live && premises.connection_type === 'hotspot' ? (
        <SecondaryButton
          onPress={() => router.push(`/premises/${premises.id}/install?job=${jobId}`)}
        >
          Fit another router
        </SecondaryButton>
      ) : null}

      {/* --- The three kinds of line ------------------------------------- */}
      <SectionLabel>What the job used and cost</SectionLabel>

      <Row
        title="Materials"
        meta={
          materials.length === 0
            ? 'Cable, sleeves, connectors — out of the site’s stock'
            : materials
                .map(
                  (line) =>
                    `${line.name} ${formatQuantity(line.quantity)}${
                      line.unit_of_measure === 'meter' ? ' m' : ''
                    }`
                )
                .join(' · ')
        }
        value={materials.length > 0 ? formatMoney(data.costs?.materials_total) : null}
        done={materials.length > 0}
        onPress={() => router.push(`/jobs/${jobId}/materials`)}
      />

      <Row
        title="Work done"
        meta={
          services.length === 0
            ? 'Splices, cable runs, setup'
            : services.map((line) => line.name).join(' · ')
        }
        value={services.length > 0 ? formatMoney(data.costs?.labour_total) : null}
        done={services.length > 0}
        onPress={() => router.push(`/jobs/${jobId}/work`)}
      />

      <Row
        title="Other costs"
        meta={
          expenses.length === 0
            ? 'Fares, casual help, permits'
            : expenses.map((line) => label(line.category)).join(' · ')
        }
        value={expenses.length > 0 ? formatMoney(data.costs?.expenses_total) : null}
        done={expenses.length > 0}
        onPress={() => router.push(`/jobs/${jobId}/expenses`)}
      />

      <SectionLabel>Job total</SectionLabel>
      <CostSummary costs={data.costs} />

      {/* --- Finishing ---------------------------------------------------- */}
      {live ? (
        <>
          <PrimaryButton onPress={() => setStatus('completed')} busy={update.isPending}>
            Mark the job done
          </PrimaryButton>
          <Text style={styles.hint}>
            You can still add a cost you remembered later — only cancelling a job closes it to
            changes.
          </Text>
          <SecondaryButton onPress={() => setStatus('cancelled')} disabled={update.isPending}>
            Cancel this job
          </SecondaryButton>
        </>
      ) : (
        <Banner tone="info">
          This job is {label(data.status).toLowerCase()}
          {data.performed_on ? `, done on ${formatDate(data.performed_on)}` : ''}.
        </Banner>
      )}

      <SecondaryButton onPress={() => router.push(`/premises/${premises.id}`)}>
        Site history for this premises
      </SecondaryButton>
      <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
    </Screen>
  );
}
