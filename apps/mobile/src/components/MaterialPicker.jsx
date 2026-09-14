import { Pressable, Text, View } from 'react-native';
import { Badge, Card, EmptyState, styles } from './ui';
import { TextField } from './fields';
import { formatMoney } from '../lib/money';
import { formatQuantity } from '../lib/format';
import { colors } from '../theme';

/**
 * What went into the job, out of the van.
 *
 * Only the tech's own bulk stock is offered, because that is the only stock
 * they can actually spend: a router is traced by serial through an
 * installation, and the API refuses a serialized item here.
 *
 * `value` is a map of { [itemId]: { quantity, notes } } rather than an array,
 * for the same reason ServicePicker does it: toggling one line cannot reorder
 * or disturb the others mid-edit.
 *
 * `recorded` is what the job ALREADY has on it, as { [itemId]: quantity }. It
 * matters because the API moves stock by the difference between the old list
 * and the new one, so what a tech may claim is the van's balance PLUS whatever
 * this job already took out of it. Without that, a job that recorded 120 m out
 * of 500 could never be corrected up to 500 — the van only shows 380 left, and
 * the form would refuse a figure the API would happily accept.
 */
export function MaterialPicker({ stock, recorded, value, onChange }) {
  const already = recorded ?? {};
  const bulk = (stock ?? []).filter(
    (row) => Number(row.quantity) > 0 || already[row.item_id] !== undefined
  );

  if (bulk.length === 0) {
    return (
      <EmptyState title="Nothing in your van to record">
        Bulk stock shows up here once it has been transferred to you. Ask the warehouse for a
        restock from the Stock tab.
      </EmptyState>
    );
  }

  const toggle = (row) => {
    const next = { ...value };
    if (next[row.item_id]) delete next[row.item_id];
    else next[row.item_id] = { quantity: '', notes: '' };
    onChange(next);
  };

  const edit = (itemId, key, text) =>
    onChange({ ...value, [itemId]: { ...value[itemId], [key]: text } });

  return (
    <View>
      {bulk.map((row) => {
        const line = value[row.item_id];
        const claimable = availableFor(row, already);
        const used = Number(line?.quantity);
        const overdrawn = Number.isFinite(used) && used > claimable;
        const unit = row.unit_of_measure === 'meter' ? 'm' : row.unit_of_measure;

        return (
          <Card key={row.item_id}>
            <Pressable
              onPress={() => toggle(row)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: Boolean(line) }}
              style={[styles.resultItem, line && styles.resultItemSelected]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{row.item_name}</Text>
                  <Text style={styles.serialStatus}>
                    {formatQuantity(Number(row.quantity))} {unit} in your van
                    {row.unit_cost ? ` · ${formatMoney(row.unit_cost)} per ${unit}` : ''}
                  </Text>
                </View>
                {line ? <Badge variant="installed">Using</Badge> : null}
              </View>
            </Pressable>

            {line ? (
              <View style={{ marginTop: 10 }}>
                <TextField
                  label={`How much did you use? (${unit})`}
                  value={line.quantity}
                  onChangeText={(text) => edit(row.item_id, 'quantity', text)}
                  keyboardType="numeric"
                  placeholder="40"
                  placeholderTextColor={colors.meta}
                  error={
                    overdrawn
                      ? `You can record up to ${formatQuantity(claimable)} ${unit}`
                      : undefined
                  }
                  hint={
                    Number.isFinite(used) && used > 0 && !overdrawn
                      ? `${formatQuantity(claimable - used)} ${unit} left in the van after this`
                      : undefined
                  }
                />
                <TextField
                  label="Notes"
                  value={line.notes}
                  onChangeText={(text) => edit(row.item_id, 'notes', text)}
                  placeholder="Optional"
                  placeholderTextColor={colors.meta}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

// The most this job may claim of an item: what is in the van now, plus what
// this job has already taken out of it.
function availableFor(row, recorded) {
  return Number(row.quantity) + Number(recorded[row.item_id] ?? 0);
}

// The picker's map, as the API's array.
export function toMaterialLines(value) {
  return Object.entries(value).map(([itemId, line]) => ({
    item_id: Number(itemId),
    quantity: Number(line.quantity),
    notes: line.notes?.trim() ? line.notes.trim() : undefined,
  }));
}

// Seeds the picker from what the job already has, so saving is an edit rather
// than a fresh start that would silently clear the existing lines — and, since
// materials move stock, put every one of them back in the van.
export function fromMaterialLines(lines) {
  return Object.fromEntries(
    (lines ?? []).map((line) => [
      line.item_id,
      { quantity: String(line.quantity), notes: line.notes ?? '' },
    ])
  );
}

// What the job already holds, for the availability sum above.
export function recordedQuantities(lines) {
  return Object.fromEntries((lines ?? []).map((line) => [line.item_id, Number(line.quantity)]));
}

// Guards the submit button. A selected line with no number, or more than the
// job may claim, is the whole set of ways this form can be wrong before it is
// sent — the API would refuse both, but not until after the tech waited for it.
export function materialLinesReady(value, stock, recorded) {
  const already = recorded ?? {};
  const byId = new Map((stock ?? []).map((row) => [row.item_id, row]));
  return Object.entries(value).every(([itemId, line]) => {
    const n = Number(line.quantity);
    if (!Number.isFinite(n) || n <= 0) return false;
    const row = byId.get(Number(itemId));
    return !row || n <= availableFor(row, already);
  });
}
