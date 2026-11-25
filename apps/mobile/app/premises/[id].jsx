import { useMemo } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useActiveInstallations,
  usePremisesHistory,
  useWorkOrders,
} from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  Stat,
  StatRow,
  styles,
} from '../../src/components/ui';
import { toTimelineEvents } from '../../src/lib/groupSerialized';
import { formatServiceLine } from '../../src/lib/format';
import { formatDate, formatDateTime, formatPremisesCode } from '../../src/lib/format';
import { REMOVAL_REASON_LABELS, label } from '../../src/lib/constants';
import { colors, fonts, radius } from '../../src/theme';

// Mockup screen 03.
export default function PremisesDetailScreen() {
  const { id } = useLocalSearchParams();
  const premisesId = Number(id);
  const router = useRouter();

  const history = usePremisesHistory(premisesId);
  const current = useActiveInstallations(premisesId);
  // A job already open here is what the tech should be adding to, rather than
  // starting a second one for the same visit.
  const openJobs = useWorkOrders({
    assigned_tech_id: 'me',
    customer_premises_id: premisesId,
    open: 'true',
  });

  const events = useMemo(() => toTimelineEvents(history.data?.timeline ?? []), [history.data]);

  if (history.isPending) return <Loading label="Loading site history" />;

  // /history 404s on an unknown premises id, unlike /current which answers
  // { current: null } with a 200. Two shapes for "nothing there"; both handled.
  if (history.isError) {
    return (
      <Screen title="Site history">
        <ErrorState
          error={history.error}
          onRetry={history.refetch}
          title={history.error?.status === 404 ? 'No such premises' : undefined}
        />
        <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
      </Screen>
    );
  }

  const { premises, total_routers: totalRouters, replacement_count: replacements } = history.data;
  const routers = current.data ?? [];
  const hasActive = routers.length > 0;
  const isHotspot = premises.connection_type === 'hotspot';
  const liveJob = (openJobs.data ?? [])[0] ?? null;

  return (
    <Screen
      eyebrow={formatPremisesCode(premises.id)}
      title={premises.label}
      sub={
        [
          // For a hotspot this is the contact person, not a subscriber.
          isHotspot && premises.customer_name
            ? `Contact: ${premises.customer_name}`
            : premises.customer_name,
          premises.site_name,
          premises.customer_account_id ? `Account ${premises.customer_account_id}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      refreshControl={
        <RefreshControl
          refreshing={history.isRefetching}
          onRefresh={() => {
            history.refetch();
            current.refetch();
            openJobs.refetch();
          }}
          tintColor={colors.teal}
        />
      }
    >
      {/* Both counts are computed server-side: replacement_count is
        * total_routers - 1, so the first router is not a "replacement". */}
      <StatRow>
        <Stat value={totalRouters} label="Total routers" />
        <Stat value={replacements} label="Replacements" />
      </StatRow>

      <SectionLabel>The place</SectionLabel>
      <Card>
        <Text style={styles.itemMeta}>
          {label(premises.connection_type)} · {label(premises.premises_type)}
        </Text>
        {isHotspot ? (
          <Text style={styles.itemMeta}>Host gets: {label(premises.hotspot_arrangement)}</Text>
        ) : null}
        {isHotspot && premises.customer_name ? (
          <Text style={styles.itemMeta}>Contact: {premises.customer_name}</Text>
        ) : null}
        {premises.customer_phone ? (
          <Text style={styles.itemMeta}>{premises.customer_phone}</Text>
        ) : null}
        {premises.landmark ? (
          <Text style={[styles.serialStatus, { marginTop: 4 }]}>{premises.landmark}</Text>
        ) : null}
        {premises.village ? (
          <Text style={styles.serialStatus}>{premises.village}</Text>
        ) : null}
        <Text style={[styles.serialStatus, { marginTop: 4 }]}>
          {premises.gps_lat === null
            ? 'No GPS pin recorded'
            : `Pin ${premises.gps_lat.toFixed(5)}, ${premises.gps_lng.toFixed(5)}` +
              (premises.gps_accuracy_m ? ` (±${premises.gps_accuracy_m} m)` : '')}
        </Text>
      </Card>

      <SectionLabel>
        {isHotspot ? `Currently installed · ${routers.length}` : 'Currently installed'}
      </SectionLabel>
      {current.isPending ? (
        <Text style={styles.hint}>Checking…</Text>
      ) : current.isError ? (
        <ErrorState error={current.error} onRetry={current.refetch} />
      ) : !hasActive ? (
        <EmptyState title="No active router here">
          Nothing is installed at this address right now.
        </EmptyState>
      ) : (
        routers.map((r) => (
          <Card flat key={r.installation_id}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{r.item_name}</Text>
              <Text style={styles.itemMeta}>{r.serial_number}</Text>
              <Text style={styles.itemMeta}>{r.mac_address ?? 'no MAC recorded'}</Text>
              <Text style={[styles.serialStatus, { marginTop: 4 }]}>
                Installed {formatDate(r.installed_at)} by {r.installed_by_name}
              </Text>
              {r.services?.length ? (
                <Text style={[styles.serialStatus, { marginTop: 4 }]}>
                  Work: {r.services.map(formatServiceLine).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Badge variant="installed">Active</Badge>
          </Card>
        ))
      )}

      <SectionLabel>Site history</SectionLabel>
      {events.length === 0 ? (
        <EmptyState title="Nothing has been installed here yet" />
      ) : (
        <Card>
          <View style={styles.timeline}>
            <View style={styles.timelineRail} />
            <View style={styles.timelineRailTop} />
            {events.map((event, index) => {
              const isOldest = index === events.length - 1;
              const removed = event.kind === 'removed';
              return (
                <View style={styles.tItem} key={event.key}>
                  <View style={[styles.tDot, removed && styles.tDotRemoved]} />
                  <Text style={styles.tDate}>{formatDateTime(event.at)}</Text>
                  <Text style={styles.tTitle}>
                    {removed ? 'Removed' : isOldest ? 'Initial install' : 'Installed'} —{' '}
                    {event.item}
                  </Text>
                  <Text style={styles.tMeta}>
                    {event.serial}
                    {event.mac ? ` · ${event.mac}` : ''}
                  </Text>
                  <Text style={styles.tMeta}>{event.by ?? 'unknown'}</Text>
                  {!removed && event.services?.length ? (
                    <Text style={styles.tMeta}>
                      Work: {event.services.map(formatServiceLine).join(' · ')}
                    </Text>
                  ) : null}
                  {event.reason ? (
                    <View
                      style={{
                        alignSelf: 'flex-start',
                        marginTop: 6,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        // The mockup gives 'upgrade' the teal variant and every
                        // other reason the danger variant.
                        backgroundColor:
                          event.reason === 'upgrade' ? colors.installedBg : colors.dangerBg,
                        borderColor:
                          event.reason === 'upgrade' ? colors.installedBorder : colors.dangerBorder,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 10,
                          color: event.reason === 'upgrade' ? colors.teal : colors.danger,
                        }}
                      >
                        {REMOVAL_REASON_LABELS[event.reason] ?? event.reason}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>
      )}

      {/* Work here goes through a job, because that is what holds the
        * materials and the costs. An open one is resumed rather than
        * duplicated. The hardware-only routes below stay for the tech who goes
        * straight at the router — the API opens a job for them. */}
      {liveJob ? (
        <PrimaryButton onPress={() => router.push(`/jobs/${liveJob.id}`)}>
          Open job #{liveJob.id}
        </PrimaryButton>
      ) : (
        <PrimaryButton onPress={() => router.push('/jobs/new')}>Start a job here</PrimaryButton>
      )}

      {/* Hardware actions follow what is actually there. A PPPoE premises with a
        * router can only be replaced; one without can only be installed. A
        * hotspot can do both — add another router, or swap one of several — so it
        * is offered each, and every swap or work record says which router. */}
      {!hasActive || isHotspot ? (
        <SecondaryButton onPress={() => router.push(`/premises/${premisesId}/install`)}>
          {hasActive ? 'Install another router' : 'Install router'}
        </SecondaryButton>
      ) : null}
      {routers.map((r) => (
        <View key={r.installation_id}>
          <SecondaryButton
            onPress={() =>
              router.push(`/premises/${premisesId}/replace?installation=${r.installation_id}`)
            }
          >
            {routers.length > 1 ? `Replace ${r.serial_number}` : 'Replace router'}
          </SecondaryButton>
          <SecondaryButton
            onPress={() =>
              router.push(`/premises/${premisesId}/work?installation=${r.installation_id}`)
            }
          >
            {r.services?.length
              ? routers.length > 1
                ? `Edit work on ${r.serial_number}`
                : 'Edit recorded work'
              : routers.length > 1
                ? `Record work on ${r.serial_number}`
                : 'Record work performed'}
          </SecondaryButton>
        </View>
      ))}
      <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
    </Screen>
  );
}
