import { Pressable, Text, View } from 'react-native';
import { Card, EmptyState, Pill, SecondaryButton, styles } from './ui';
import { TextField } from './fields';
import { formatMoney, parseAmount } from '../lib/money';
import { JOB_EXPENSE_CATEGORIES, label } from '../lib/constants';
import { colors, fonts } from '../theme';

/**
 * The money that is neither stock nor labour.
 *
 * Transport is why this exists. A compound an hour off the road costs a fare
 * each way, and that is a real cost of the connection that nothing else in the
 * app would ever capture — so the tech pays it, and until now nobody could
 * record it.
 *
 * A list rather than a map, unlike the other two pickers, because two fares on
 * one job are two facts and not a double entry. The API takes them the same
 * way and puts no uniqueness rule on the category.
 *
 * `value` is [{ key, category, amount, description }]. `key` is local, for
 * React's benefit only, and never sent.
 */
export function ExpenseEditor({ value, onChange }) {
  const add = () =>
    onChange([
      ...value,
      { key: `e-${Date.now()}-${value.length}`, category: 'transport', amount: '', description: '' },
    ]);

  const edit = (key, field, next) =>
    onChange(value.map((row) => (row.key === key ? { ...row, [field]: next } : row)));

  const remove = (key) => onChange(value.filter((row) => row.key !== key));

  return (
    <View>
      {value.length === 0 ? (
        <EmptyState title="No other costs recorded">
          Fares, casual help, permits — anything you spent getting this job done.
        </EmptyState>
      ) : (
        value.map((row) => (
          <Card key={row.key}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text style={styles.itemName}>{formatMoney(parseAmount(row.amount)) }</Text>
              <Pressable onPress={() => remove(row.key)} hitSlop={8}>
                <Text style={{ fontFamily: fonts.display, fontSize: 12, color: colors.danger }}>
                  Remove
                </Text>
              </Pressable>
            </View>

            <View style={[styles.pillRow, { marginBottom: 12 }]}>
              {JOB_EXPENSE_CATEGORIES.map((category) => (
                <Pill
                  key={category}
                  active={row.category === category}
                  onPress={() => edit(row.key, 'category', category)}
                >
                  {label(category)}
                </Pill>
              ))}
            </View>

            <TextField
              label="Amount (KES)"
              value={row.amount}
              onChangeText={(text) => edit(row.key, 'amount', text)}
              keyboardType="numeric"
              placeholder="300"
              placeholderTextColor={colors.meta}
              error={
                row.amount.trim() !== '' && !(parseAmount(row.amount) > 0)
                  ? 'Give an amount greater than zero'
                  : undefined
              }
            />
            <TextField
              label="What was it for?"
              value={row.description}
              onChangeText={(text) => edit(row.key, 'description', text)}
              placeholder="Boda from Kanduyi"
              placeholderTextColor={colors.meta}
            />
          </Card>
        ))
      )}

      <SecondaryButton onPress={add}>+ Add a cost</SecondaryButton>
    </View>
  );
}

// The editor's rows, as the API's array. The local `key` is dropped.
export function toExpenseLines(value) {
  return value.map((row) => ({
    category: row.category,
    amount: parseAmount(row.amount),
    description: row.description?.trim() ? row.description.trim() : undefined,
  }));
}

export function fromExpenseLines(lines) {
  return (lines ?? []).map((line, index) => ({
    key: `e-${line.id ?? index}`,
    category: line.category,
    amount: String(line.amount),
    description: line.description ?? '',
  }));
}

// Guards the submit button: a row with no amount, or a nonsense one, is the
// only way this form can be wrong before it is sent.
export const expenseLinesReady = (value) =>
  value.every((row) => {
    const amount = parseAmount(row.amount);
    return amount !== null && amount > 0;
  });
