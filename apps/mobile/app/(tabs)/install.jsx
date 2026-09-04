import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePremisesSearch, useWorkOrders } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import { SearchBar } from '../../src/components/fields';
import {
  Badge,
  EmptyState,
  ErrorState,
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

// Mockup screen 02, upper half: find the premises to work at.
export default function InstallScreen() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term);
  const search = usePremisesSearch(debounced);

  // `assigned_tech_id=me` resolves server-side, so the app does not need to
  // know its own user id to build the query.
  const jobs = useWorkOrders({ assigned_tech_id: 'me', status: 'open' });
  const inProgress = useWorkOrders({ assigned_tech_id: 'me', status: 'in_progress' });

  // Typing a PREM code off a dispatch note jumps straight there. That code is a
  // display format only — never sent to the API.
  const codeId = parsePremisesCode(term);
  useEffect(() => {
    if (codeId) {
      setTerm('');
      router.push(`/premises/${codeId}`);
    }
  }, [codeId, router]);

  const openJobs = [...(inProgress.data ?? []), ...(jobs.data ?? [])];
  const tooShort = debounced.trim().length < 2;

  return (
    <Screen eyebrow="Field work" title="Find premises" sub="Search an address, or pick one of your jobs">
      {openJobs.length > 0 ? (
        <>
          <SectionLabel>My jobs today</SectionLabel>
          {openJobs.map((job) => (
            <Pressable
              key={job.id}
              onPress={() => router.push(`/premises/${job.customer_premises_id}`)}
              style={styles.resultItem}
            >
              <WorkOrderChip>
                Job #{job.id} · {label(job.type)}
              </WorkOrderChip>
              <Text style={styles.resultAddr}>{job.address}</Text>
              <Text style={styles.resultId}>
                {formatPremisesCode(job.customer_premises_id)}
                {job.scheduled_date ? ` · ${formatDate(job.scheduled_date)}` : ''}
              </Text>
              <View style={{ marginTop: 6 }}>
                <Badge value={job.status} />
              </View>
            </Pressable>
          ))}
        </>
      ) : null}

      <SectionLabel>Search</SectionLabel>
      <SearchBar
        value={term}
        onChangeText={setTerm}
        placeholder="Ngong Road, KE-77291, or PREM-00001"
      />

      {/* Under two characters the API returns { results: [] } with a 200. That
        * is not "no matches" — a hint is the honest rendering. */}
      {tooShort ? (
        <Text style={styles.hint}>Type at least 2 characters to search.</Text>
      ) : search.isPending ? (
        <Text style={styles.hint}>Searching…</Text>
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={search.refetch} />
      ) : search.data.length === 0 ? (
        <EmptyState title="No premises match">
          Nothing found for “{debounced}”. Add the address before installing there.
        </EmptyState>
      ) : (
        search.data.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => router.push(`/premises/${row.id}`)}
            style={styles.resultItem}
          >
            <Text style={styles.resultAddr}>{row.address}</Text>
            <Text style={styles.resultId}>
              {formatPremisesCode(row.id)}
              {row.customer_account_id ? ` · ${row.customer_account_id}` : ''}
            </Text>
          </Pressable>
        ))
      )}

      <Pressable onPress={() => router.push('/premises/new')} style={{ marginTop: 14 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 13, color: colors.teal }}>
          + Add a new address
        </Text>
      </Pressable>
    </Screen>
  );
}
