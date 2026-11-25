import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useJob,
  usePremisesAtSite,
  usePremisesSearch,
  useSites,
  useUpdateWorkOrder,
} from '../../../src/api/queries';
import { Screen } from '../../../src/components/Screen';
import { SearchBar } from '../../../src/components/fields';
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
import {
  PremisesForm,
  emptyPremises,
  premisesLocatable,
  toPremisesBody,
} from '../../../src/components/PremisesForm';
import { formatPremisesCode } from '../../../src/lib/format';
import { colors } from '../../../src/theme';

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Setting the premises on a job that was dispatched without one.
//
// A manager can open a new install before anybody has found the compound, with
// only the site and a rough location in the notes. The tech finds the place and
// says which premises it is — one already on record at the job's site, or one
// captured now. The API refuses a premises at another site and a job that
// already has one, so the list is narrowed to the job's own site up front.
export default function JobPremisesScreen() {
  const { id } = useLocalSearchParams();
  const jobId = Number(id);
  const router = useRouter();

  const job = useJob(jobId);
  const sites = useSites();
  const update = useUpdateWorkOrder();

  const [way, setWay] = useState('browse');
  const [chosen, setChosen] = useState(null);
  const [term, setTerm] = useState('');
  const [premises, setPremises] = useState(emptyPremises);
  const [gps, setGps] = useState(null);
  const [error, setError] = useState(null);

  const siteId = job.data?.site_id ?? null;
  const debounced = useDebounced(term);
  const search = usePremisesSearch(debounced, siteId);
  const atSite = usePremisesAtSite(way === 'browse' ? siteId : null);

  if (job.isPending) return <Loading label="Loading the job" />;

  const capturing = way === 'new';
  const ready = capturing ? premisesLocatable(premises, gps) : Boolean(chosen);
  const results = way === 'search' ? (search.data ?? []) : (atSite.data ?? []);

  async function onSubmit() {
    setError(null);
    try {
      await update.mutateAsync({
        id: jobId,
        ...(capturing
          ? // Filed under the job's site by the API.
            { premises: toPremisesBody({ ...premises, site_id: siteId }, gps) }
          : { customer_premises_id: chosen.id }),
      });
      router.replace(`/jobs/${jobId}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={`Job #${jobId}`}
      title="Set the premises"
      sub={[job.data?.site_name, job.data?.notes].filter(Boolean).join(' · ') || undefined}
    >
      {error ? <Banner>{error.message}</Banner> : null}

      <View style={[styles.pillRow, { marginBottom: 12 }]}>
        {[
          ['browse', 'Pick from site'],
          ['search', 'Search'],
          ['new', 'New premises'],
        ].map(([key, text]) => (
          <Pill
            key={key}
            active={way === key}
            onPress={() => {
              setWay(key);
              setChosen(null);
            }}
          >
            {text}
          </Pill>
        ))}
      </View>

      {way === 'search' ? (
        <SearchBar
          value={term}
          onChangeText={setTerm}
          placeholder="Name, village, landmark, or 07xx…"
        />
      ) : null}

      {capturing ? (
        <PremisesForm
          value={premises}
          onChange={setPremises}
          gps={gps}
          onGpsChange={setGps}
          sites={(sites.data ?? []).filter((s) => s.id === siteId)}
          heading="The place"
        />
      ) : way === 'search' && debounced.trim().length < 2 ? (
        <Text style={styles.hint}>Type at least 2 characters to search.</Text>
      ) : results.length === 0 ? (
        <EmptyState title="Nothing here yet">
          {way === 'browse'
            ? 'No premises recorded at this site. Capture this one with “New premises”.'
            : 'No matches at this site. Capture the place with “New premises”.'}
        </EmptyState>
      ) : (
        results.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => setChosen(row)}
            style={[styles.resultItem, chosen?.id === row.id && styles.resultItemSelected]}
          >
            <Text style={styles.resultAddr}>{row.label}</Text>
            <Text style={styles.resultId}>
              {formatPremisesCode(row.id)}
              {row.customer_name ? ` · ${row.customer_name}` : ''}
              {row.customer_phone ? ` · ${row.customer_phone}` : ''}
            </Text>
            <Text style={[styles.resultId, { color: colors.decorative }]}>
              {row.gps_lat === null ? 'no GPS pin' : `pin ±${row.gps_accuracy_m ?? '?'} m`}
            </Text>
          </Pressable>
        ))
      )}

      {capturing && !ready ? (
        <Text style={styles.hint}>
          Take a GPS fix, or give a landmark or an address — and say token or voucher for a
          hotspot.
        </Text>
      ) : null}

      <PrimaryButton onPress={onSubmit} disabled={!ready} busy={update.isPending}>
        {capturing ? 'Capture and set' : 'Set premises'}
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={update.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
