import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePremisesSearch, useWorkOrders } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import { SearchBar } from '../../src/components/fields';
import {
  Badge,
  EmptyState,
  ErrorState,
  PrimaryButton,
  SectionLabel,
  WorkOrderChip,
  styles,
} from '../../src/components/ui';
import { formatDate, formatPremisesCode, parsePremisesCode } from '../../src/lib/format';
import { label } from '../../src/lib/constants';
import { colors, fonts } from '../../src/theme';

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// The tech's home screen.
//
// It leads with "Start a job" rather than with a search box, which is the whole
// change: most of the work here is found, not dispatched, and the old screen
// assumed a manager had already ticketed it. Anything the manager DID ticket
// shows in the same list, because to the tech they are the same thing.
export default function JobsScreen() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term);
  const search = usePremisesSearch(debounced);

  // One request for both live statuses. `assigned_tech_id=me` resolves
  // server-side, so the app does not need to know its own user id.
  const jobs = useWorkOrders({ assigned_tech_id: 'me', open: 'true' });

  // Typing a PREM code off a dispatch note jumps straight there. That code is a
  // display format only — never sent to the API.
  const codeId = parsePremisesCode(term);
  useEffect(() => {
    if (codeId) {
      setTerm('');
      router.push(`/premises/${codeId}`);
    }
  }, [codeId, router]);

  const openJobs = jobs.data ?? [];
  const tooShort = debounced.trim().length < 2;

  return (
    <Screen
      eyebrow="Field work"
      title="My jobs"
      sub="Start a job wherever you are, or pick one you were sent"
      refreshControl={
        <RefreshControl
          refreshing={jobs.isRefetching}
          onRefresh={jobs.refetch}
          tintColor={colors.teal}
        />
      }
    >
      <PrimaryButton onPress={() => router.push('/jobs/new')}>Start a job</PrimaryButton>

      <SectionLabel>Open jobs</SectionLabel>
      {jobs.isPending ? (
        <Text style={styles.hint}>Loading your jobs…</Text>
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={jobs.refetch} />
      ) : openJobs.length === 0 ? (
        <EmptyState title="Nothing open">
          Start a job when you get to the next premises. Finished jobs are under History.
        </EmptyState>
      ) : (
        openJobs.map((job) => (
          <Pressable
            key={job.id}
            onPress={() => router.push(`/jobs/${job.id}`)}
            style={styles.resultItem}
          >
            <WorkOrderChip>
              Job #{job.id} · {label(job.type)}
            </WorkOrderChip>
            <Text style={styles.resultAddr}>{job.label}</Text>
            <Text style={styles.resultId}>
              {formatPremisesCode(job.customer_premises_id)}
              {job.site_name ? ` · ${job.site_name}` : ''}
              {job.scheduled_date ? ` · due ${formatDate(job.scheduled_date)}` : ''}
            </Text>
            <View style={{ marginTop: 6, flexDirection: 'row', gap: 6 }}>
              <Badge value={job.status} />
              {/* A job somebody else opened for you is worth flagging, because
                * it is the one you did not already know about. */}
              {job.created_by && Number(job.created_by) !== Number(job.assigned_tech_id) ? (
                <Badge>Sent to you</Badge>
              ) : null}
            </View>
          </Pressable>
        ))
      )}

      <SectionLabel>Look up a premises</SectionLabel>
      <SearchBar
        value={term}
        onChangeText={setTerm}
        placeholder="Name, village, landmark, or 07xx…"
      />

      {/* Under two characters the API returns { results: [] } with a 200. That
        * is not "no matches" — a hint is the honest rendering. */}
      {tooShort ? (
        <Text style={styles.hint}>
          Type at least 2 characters. A customer name or a village works as well as an address.
        </Text>
      ) : search.isPending ? (
        <Text style={styles.hint}>Searching…</Text>
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={search.refetch} />
      ) : search.data.length === 0 ? (
        <EmptyState title="No premises match">
          Nothing found for “{debounced}”. Start a job and capture the place as you go.
        </EmptyState>
      ) : (
        search.data.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => router.push(`/premises/${row.id}`)}
            style={styles.resultItem}
          >
            <Text style={styles.resultAddr}>{row.label}</Text>
            <Text style={styles.resultId}>
              {formatPremisesCode(row.id)}
              {row.site_name ? ` · ${row.site_name}` : ''}
              {row.customer_phone ? ` · ${row.customer_phone}` : ''}
            </Text>
          </Pressable>
        ))
      )}

      <Pressable onPress={() => router.push('/premises/new')} style={{ marginTop: 14 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 13, color: colors.teal }}>
          + Add a premises without starting a job
        </Text>
      </Pressable>
    </Screen>
  );
}
