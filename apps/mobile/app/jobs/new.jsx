import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useCreateJob,
  usePremisesAtSite,
  usePremisesSearch,
  useSites,
} from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import { SearchBar } from '../../src/components/fields';
import {
  Banner,
  EmptyState,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../src/components/ui';
import {
  PremisesForm,
  emptyPremises,
  premisesLocatable,
  toPremisesBody,
} from '../../src/components/PremisesForm';
import { WORK_ORDER_TYPES, label } from '../../src/lib/constants';
import { formatPremisesCode } from '../../src/lib/format';
import { colors, fonts } from '../../src/theme';

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Starting a job.
//
// One screen and one submit, because the two halves of it are one decision: a
// tech standing at a compound nobody has recorded should not have to create the
// premises, watch the signal drop, and come back to find an address with no job
// against it. POST /api/work-orders takes the premises inline and writes both
// in one transaction, so either both exist or neither does.
//
// Three ways to say where you are, in the order they are actually useful here:
// browse the site you are working (most compounds have no address to type),
// search, or capture a new one.
const WAYS = [
  ['browse', 'Pick from site'],
  ['search', 'Search'],
  ['new', 'New premises'],
];

export default function NewJobScreen() {
  const router = useRouter();
  const sites = useSites();
  const create = useCreateJob();

  const [type, setType] = useState('new_install');
  const [way, setWay] = useState('browse');
  const [siteId, setSiteId] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [term, setTerm] = useState('');
  const [error, setError] = useState(null);

  // The new-premises form, only used when `way` is 'new'.
  const [premises, setPremises] = useState(emptyPremises);
  const [gps, setGps] = useState(null);

  const debounced = useDebounced(term);
  const search = usePremisesSearch(debounced, siteId);
  const atSite = usePremisesAtSite(way === 'browse' ? siteId : null);

  // With two sites, defaulting to neither means an extra tap on every job. The
  // first one is not a guess about which — it is the list the tech scrolls, and
  // switching is one tap away.
  useEffect(() => {
    if (siteId === null && sites.data?.length) setSiteId(sites.data[0].id);
  }, [siteId, sites.data]);

  const capturing = way === 'new';
  const ready = capturing ? premisesLocatable(premises, gps) : Boolean(chosen);

  async function onSubmit() {
    setError(null);
    try {
      const body = { type };
      if (capturing) {
        body.premises = toPremisesBody(
          // A premises captured while working a site belongs to that site
          // unless the tech said otherwise.
          { ...premises, site_id: premises.site_id ?? siteId },
          gps
        );
      } else {
        body.customer_premises_id = chosen.id;
      }

      const { work_order: job } = await create.mutateAsync(body);
      router.replace(`/jobs/${job.id}`);
    } catch (err) {
      setError(err);
    }
  }

  const results = way === 'search' ? (search.data ?? []) : (atSite.data ?? []);

  return (
    <Screen eyebrow="Field work" title="Start a job" sub="What are you doing, and where">
      {error ? <Banner>{error.message}</Banner> : null}

      <SectionLabel>What kind of job</SectionLabel>
      <View style={styles.pillRow}>
        {WORK_ORDER_TYPES.map((option) => (
          <Pill key={option} active={type === option} onPress={() => setType(option)}>
            {label(option)}
          </Pill>
        ))}
      </View>

      <SectionLabel>Where</SectionLabel>
      <View style={[styles.pillRow, { marginBottom: 12 }]}>
        {WAYS.map(([key, text]) => (
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

      {sites.data?.length && way !== 'new' ? (
        <View style={[styles.pillRow, { marginBottom: 12 }]}>
          {sites.data.map((site) => (
            <Pill key={site.id} active={siteId === site.id} onPress={() => setSiteId(site.id)}>
              {site.name}
            </Pill>
          ))}
        </View>
      ) : null}

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
          sites={sites.data ?? []}
          heading="The place"
        />
      ) : (
        <>
          {way === 'search' && debounced.trim().length < 2 ? (
            <Text style={styles.hint}>Type at least 2 characters to search.</Text>
          ) : results.length === 0 ? (
            <EmptyState title="Nothing here yet">
              {way === 'browse'
                ? 'No premises recorded at this site. Capture this one with “New premises”.'
                : 'No matches. Capture the place with “New premises”.'}
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
                {/* A pin is the reason this row is findable at all, so say
                  * whether there is one. */}
                <Text style={[styles.resultId, { color: colors.decorative }]}>
                  {row.gps_lat === null ? 'no GPS pin' : `pin ±${row.gps_accuracy_m ?? '?'} m`}
                </Text>
              </Pressable>
            ))
          )}
        </>
      )}

      {capturing && !ready ? (
        <Text style={styles.hint}>
          Take a GPS fix, or give a landmark or an address, before starting the job.
        </Text>
      ) : null}

      <PrimaryButton onPress={onSubmit} disabled={!ready} busy={create.isPending}>
        {capturing ? 'Capture and start' : 'Start job'}
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={create.isPending}>
        Cancel
      </SecondaryButton>

      <Text style={[styles.hint, { marginTop: 4 }]}>
        You record the router, the materials and the costs on the job screen after this.
      </Text>
    </Screen>
  );
}
