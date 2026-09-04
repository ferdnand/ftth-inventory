import { useMemo } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCurrentInstallation, usePremisesHistory } from '../../src/api/queries';
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
import { formatDate, formatDateTime, formatPremisesCode } from '../../src/lib/format';
import { REMOVAL_REASON_LABELS } from '../../src/lib/constants';
import { colors, fonts, radius } from '../../src/theme';

// Mockup screen 03.
export default function PremisesDetailScreen() {
  const { id } = useLocalSearchParams();
  const premisesId = Number(id);
  const router = useRouter();

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);

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
  const hasActive = current.data != null;

  return (
    <Screen
      eyebrow={formatPremisesCode(premises.id)}
      title={premises.address}
      sub={premises.customer_account_id ? `Account ${premises.customer_account_id}` : undefined}
      refreshControl={
        <RefreshControl
          refreshing={history.isRefetching}
          onRefresh={() => {
            history.refetch();
            current.refetch();
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

      <SectionLabel>Currently installed</SectionLabel>
      {current.isPending ? (
        <Text style={styles.hint}>Checking…</Text>
      ) : current.isError ? (
        <ErrorState error={current.error} onRetry={current.refetch} />
      ) : !hasActive ? (
        <EmptyState title="No active router here">
          Nothing is installed at this address right now.
        </EmptyState>
      ) : (
        <Card flat>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{current.data.item_name}</Text>
            <Text style={styles.itemMeta}>{current.data.serial_number}</Text>
            <Text style={styles.itemMeta}>{current.data.mac_address ?? 'no MAC recorded'}</Text>
            <Text style={[styles.serialStatus, { marginTop: 4 }]}>
              Installed {formatDate(current.data.installed_at)} by {current.data.installed_by_name}
            </Text>
          </View>
          <Badge variant="installed">Active</Badge>
        </Card>
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

      {/* One action, chosen by what is actually there — offering both would
        * guarantee one of them 404s or 409s. */}
      {hasActive ? (
        <PrimaryButton onPress={() => router.push(`/premises/${premisesId}/replace`)}>
          Replace router
        </PrimaryButton>
      ) : (
        <PrimaryButton onPress={() => router.push(`/premises/${premisesId}/install`)}>
          Install router
        </PrimaryButton>
      )}
      <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
    </Screen>
  );
}
