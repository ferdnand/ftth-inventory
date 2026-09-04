import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import {
  useCreateRestockRequest,
  useItems,
  useLocations,
  useRestockRequests,
  useStock,
} from '../src/api/queries';
import { Screen } from '../src/components/Screen';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  Loading,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  styles,
} from '../src/components/ui';
import { formatQuantity, formatRelative } from '../src/lib/format';
import { label } from '../src/lib/constants';
import { colors } from '../src/theme';

// Why this screen exists rather than a "top up my van" button: the only stock
// write a tech could otherwise make is a warehouse -> van transfer, which is
// self-issuing warehouse stock with no approval. A request is a separate object
// that warehouse staff fulfil, and fulfilment is what moves the stock.
export default function RestockScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const warehouses = useLocations('warehouse');
  const items = useItems();
  const stock = useStock(user?.assigned_location_id);
  const existing = useRestockRequests({ status: 'requested' });
  const approved = useRestockRequests({ status: 'approved' });
  const create = useCreateRestockRequest();

  const [warehouseId, setWarehouseId] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Only bulk items can be requested by quantity: which specific serialized
  // unit a tech gets is the warehouse's choice at fulfilment time, so the API
  // refuses a serialized line.
  const bulkItems = useMemo(
    () => (items.data ?? []).filter((i) => i.tracking_type === 'bulk'),
    [items.data]
  );

  const onHand = new Map((stock.data?.bulk ?? []).map((r) => [r.item_id, r]));
  const pending = [...(existing.data ?? []), ...(approved.data ?? [])];

  if (items.isPending || warehouses.isPending) return <Loading label="Loading" />;

  const chosenWarehouse = warehouseId ?? warehouses.data[0]?.id ?? null;

  const lines = Object.entries(amounts)
    .map(([itemId, value]) => ({ item_id: Number(itemId), quantity_requested: Number(value) }))
    .filter((line) => Number.isFinite(line.quantity_requested) && line.quantity_requested > 0);

  async function onSubmit() {
    setError(null);
    try {
      await create.mutateAsync({
        from_location_id: chosenWarehouse,
        lines,
      });
      setAmounts({});
      setDone(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen
      eyebrow={user?.assigned_location_name ?? 'My van'}
      title="Request a restock"
      sub="The warehouse approves and sends it; nothing moves until they do"
    >
      {error ? <Banner>{error.message}</Banner> : null}
      {done ? (
        <Banner tone="info">
          Request sent. The warehouse will see it in their queue — you will see the stock arrive in
          your van once they fulfil it.
        </Banner>
      ) : null}

      {pending.length > 0 ? (
        <>
          <SectionLabel>Waiting on the warehouse</SectionLabel>
          {pending.map((request) => (
            <Card key={request.id}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>Request #{request.id}</Text>
                  <Text style={styles.itemMeta}>
                    {request.from_location_name} · {formatRelative(request.created_at)}
                  </Text>
                </View>
                <Badge value={request.status} />
              </View>
              <View style={{ marginTop: 8 }}>
                {request.lines.map((line) => (
                  <View key={line.id} style={styles.serialRow}>
                    <Text style={{ flex: 1, ...styles.serialId }}>{line.item_name}</Text>
                    <Text style={styles.serialId}>
                      {formatQuantity(line.quantity_requested)} {line.unit_of_measure}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {warehouses.data.length > 1 ? (
        <>
          <SectionLabel>Draw from</SectionLabel>
          <View style={styles.pillRow}>
            {warehouses.data.map((w) => (
              <Pill key={w.id} active={chosenWarehouse === w.id} onPress={() => setWarehouseId(w.id)}>
                {w.name}
              </Pill>
            ))}
          </View>
        </>
      ) : null}

      <SectionLabel>What do you need?</SectionLabel>
      {bulkItems.length === 0 ? (
        <EmptyState title="No bulk items in the catalog" />
      ) : (
        bulkItems.map((item) => {
          const held = onHand.get(item.id);
          const low = held?.is_low_stock === true;
          return (
            <Card key={item.id} low={low} flat>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {held ? `${formatQuantity(held.quantity)} ${item.unit_of_measure} in van` : 'none in van'}
                </Text>
                {low ? (
                  <View style={{ marginTop: 6 }}>
                    <Badge variant="low">Reorder soon</Badge>
                  </View>
                ) : null}
              </View>
              <View style={{ width: 96 }}>
                <TextInput
                  style={[styles.input, { textAlign: 'right', paddingVertical: 8 }]}
                  value={amounts[item.id] ?? ''}
                  onChangeText={(value) =>
                    setAmounts((current) => ({ ...current, [item.id]: value.replace(/[^0-9.]/g, '') }))
                  }
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.text3}
                  accessibilityLabel={`Quantity of ${item.name} to request`}
                />
                <Text style={[styles.qtyUnit, { marginTop: 4 }]}>{item.unit_of_measure}</Text>
              </View>
            </Card>
          );
        })
      )}

      <PrimaryButton
        onPress={onSubmit}
        disabled={lines.length === 0 || !chosenWarehouse}
        busy={create.isPending}
      >
        Send request{lines.length > 0 ? ` (${lines.length} item${lines.length === 1 ? '' : 's'})` : ''}
      </PrimaryButton>
      <SecondaryButton onPress={() => router.back()}>Back</SecondaryButton>
    </Screen>
  );
}
