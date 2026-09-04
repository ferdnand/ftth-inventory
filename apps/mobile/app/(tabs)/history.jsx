import { useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { useTransactions, useWorkOrders } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Pill,
  styles,
} from '../../src/components/ui';
import { formatDate, formatDateTime, formatQuantity } from '../../src/lib/format';
import { label } from '../../src/lib/constants';
import { colors } from '../../src/theme';

export default function HistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [segment, setSegment] = useState('movements');

  // The API scopes a tech's feed to their own van whether or not it is asked
  // for, so this cannot be used to browse other locations.
  const movements = useTransactions({ limit: 50 });
  const jobs = useWorkOrders({ assigned_tech_id: 'me' });

  const active = segment === 'movements' ? movements : jobs;

  return (
    <Screen
      eyebrow={user?.assigned_location_name ?? 'My activity'}
      title="History"
      sub="What you have moved, and the jobs assigned to you"
      refreshControl={
        <RefreshControl
          refreshing={active.isRefetching}
          onRefresh={active.refetch}
          tintColor={colors.teal}
        />
      }
    >
      <View style={[styles.pillRow, { marginBottom: 14 }]}>
        <Pill active={segment === 'movements'} onPress={() => setSegment('movements')}>
          My movements
        </Pill>
        <Pill active={segment === 'jobs'} onPress={() => setSegment('jobs')}>
          My jobs
        </Pill>
      </View>

      {active.isPending ? (
        <Loading label="Loading" />
      ) : active.isError ? (
        <ErrorState error={active.error} onRetry={active.refetch} />
      ) : segment === 'movements' ? (
        movements.data.length === 0 ? (
          <EmptyState title="No movements yet">
            Installing a router or issuing material will show up here.
          </EmptyState>
        ) : (
          movements.data.map((t) => (
            <Card key={t.id} flat>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>
                  {label(t.type)} · {t.item_name}
                </Text>
                <Text style={styles.itemMeta}>
                  {t.serial_number ??
                    `${formatQuantity(t.quantity)} ${t.unit_of_measure}`}
                </Text>
                <Text style={styles.itemMeta}>
                  {[t.from_location_name, t.to_location_name].filter(Boolean).join(' → ') ||
                    'customer premises'}
                </Text>
                <Text style={[styles.serialStatus, { marginTop: 4 }]}>
                  {formatDateTime(t.created_at)} · {t.performed_by_name}
                </Text>
              </View>
            </Card>
          ))
        )
      ) : jobs.data.length === 0 ? (
        <EmptyState title="No jobs assigned to you">
          Work orders are optional — you can install without one.
        </EmptyState>
      ) : (
        jobs.data.map((job) => (
          <Card key={job.id}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>
                  #{job.id} · {label(job.type)}
                </Text>
                <Text style={styles.itemMeta}>{job.address}</Text>
                <Text style={styles.serialStatus}>
                  {job.scheduled_date ? formatDate(job.scheduled_date) : 'not scheduled'}
                </Text>
              </View>
              <Badge value={job.status} />
            </View>
            <View style={{ marginTop: 10 }}>
              <Pill onPress={() => router.push(`/premises/${job.customer_premises_id}`)}>
                Open site history
              </Pill>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
