import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useJob, useSetJobExpenses } from '../../../src/api/queries';
import { Screen } from '../../../src/components/Screen';
import {
  ExpenseEditor,
  expenseLinesReady,
  fromExpenseLines,
  toExpenseLines,
} from '../../../src/components/ExpenseEditor';
import {
  Banner,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../../../src/components/ui';
import { formatMoney, parseAmount } from '../../../src/lib/money';

// Everything the job cost that was neither stock nor labour.
//
// The fare is the one that matters. A compound an hour off the road costs money
// to reach, the tech pays it out of pocket, and before this there was nowhere in
// the system to say so.
export default function JobExpensesScreen() {
  const { id } = useLocalSearchParams();
  const jobId = Number(id);
  const router = useRouter();

  const job = useJob(jobId);
  const save = useSetJobExpenses();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  if (job.isPending) return <Loading label="Loading" />;

  const value = draft ?? fromExpenseLines(job.data?.expenses);

  // Adding up as they type, because the total is the number the tech is
  // actually reconciling against what is in their pocket.
  const running = value.reduce((total, row) => total + (parseAmount(row.amount) ?? 0), 0);

  async function onSubmit() {
    setError(null);
    try {
      await save.mutateAsync({ jobId, expenses: toExpenseLines(value) });
      router.replace(`/jobs/${jobId}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={`Job #${jobId}`}
      title="Other costs"
      sub={job.data?.label}
    >
      {error ? <Banner>{error.message}</Banner> : null}

      <SectionLabel>What you spent on this job</SectionLabel>
      <ExpenseEditor value={value} onChange={setDraft} />

      {value.length > 0 ? (
        <Text style={[styles.hint, { marginTop: 10 }]}>
          {value.length} {value.length === 1 ? 'cost' : 'costs'} · {formatMoney(running)}
        </Text>
      ) : null}

      <PrimaryButton
        onPress={onSubmit}
        disabled={!expenseLinesReady(value)}
        busy={save.isPending}
      >
        Save costs
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()} disabled={save.isPending}>
        Cancel
      </SecondaryButton>
    </Screen>
  );
}
