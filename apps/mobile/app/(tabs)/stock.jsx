import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { useStock } from '../../src/api/queries';
import { Screen } from '../../src/components/Screen';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  SectionLabel,
  SecondaryButton,
  Stat,
  StatRow,
  styles,
} from '../../src/components/ui';
import { groupSerialized, isModelLow } from '../../src/lib/groupSerialized';
import { formatQuantity, formatRelative } from '../../src/lib/format';
import { colors, fonts } from '../../src/theme';

// Mockup screen 01, with one addition the mockup lacks — see "To return" below.
export default function StockScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const locationId = user?.assigned_location_id;
  const stock = useStock(locationId);
  const [expanded, setExpanded] = useState(() => new Set());

  const groups = useMemo(() => groupSerialized(stock.data?.serialized ?? []), [stock.data]);

  const toggle = (itemId) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  // A tech with no assigned_location_id sees an empty van however much stock is
  // really out there. Name the actual cause rather than showing "no stock".
  if (!locationId) {
    return (
      <Screen eyebrow="My stock" title="No van assigned">
        <EmptyState title="You have no assigned location">
          A manager needs to set your assigned van under Users on the dashboard before your stock
          can show up here.
        </EmptyState>
      </Screen>
    );
  }

  if (stock.isPending) return <Loading label="Loading your van" />;

  const bulkRows = stock.data?.bulk ?? [];
  const lowCount =
    groups.filter(isModelLow).length + bulkRows.filter((r) => r.is_low_stock === true).length;
  const serializedUnits = groups.reduce((sum, g) => sum + g.installable.length, 0);
  const toReturn = groups.flatMap((g) => g.toReturn.map((u) => ({ ...u, item_name: g.item_name })));

  return (
    <Screen
      eyebrow={user.assigned_location_name ?? 'My van'}
      title="My Stock"
      sub={`${user.name} · last synced ${formatRelative(stock.dataUpdatedAt)}`}
      refreshControl={
        <RefreshControl
          refreshing={stock.isRefetching}
          onRefresh={stock.refetch}
          tintColor={colors.teal}
        />
      }
    >
      {stock.isError ? <ErrorState error={stock.error} onRetry={stock.refetch} /> : null}

      <StatRow>
        <Stat value={serializedUnits} label="Ready" />
        <Stat value={bulkRows.length} label="Bulk items" />
        <Stat value={lowCount} label="Low stock" warn={lowCount > 0} />
      </StatRow>

      <SectionLabel>Serialized — CPE &amp; actives</SectionLabel>
      {groups.length === 0 ? (
        <EmptyState title="No units in your van">
          Ask the warehouse for stock, or raise a restock request.
        </EmptyState>
      ) : (
        groups.map((group) => {
          const low = isModelLow(group);
          const open = expanded.has(group.item_id);
          return (
            <Card key={group.item_id} low={low}>
              <Pressable
                onPress={() => toggle(group.item_id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{group.item_name}</Text>
                  <Text style={styles.itemMeta}>
                    {[group.manufacturer, group.model].filter(Boolean).join(' ') || group.category}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {group.installable.length > 0 ? (
                      <Badge variant="ok">Ready to install</Badge>
                    ) : (
                      <Badge variant="low">None ready</Badge>
                    )}
                    {low && group.installable.length > 0 ? (
                      <Badge variant="low">Reorder soon</Badge>
                    ) : null}
                  </View>
                </View>
                <View>
                  <Text style={styles.qty}>{group.installable.length}</Text>
                  <Text style={styles.qtyUnit}>
                    unit{group.installable.length === 1 ? '' : 's'} in van
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      color: colors.meta,
                      textAlign: 'right',
                      marginTop: 4,
                    }}
                  >
                    {open ? 'hide serials' : 'show serials'}
                  </Text>
                </View>
              </Pressable>

              {/* Grouping must not lose the per-unit data — a tech needs the
                * serials to pick one, and to read one out on the phone. */}
              {open ? (
                <View style={{ marginTop: 10 }}>
                  {group.units.map((unit) => (
                    <View key={unit.id} style={styles.serialRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.serialId}>{unit.serial_number}</Text>
                        <Text style={styles.serialStatus}>
                          {unit.mac_address ?? 'no MAC recorded'}
                        </Text>
                      </View>
                      <Badge value={unit.status} />
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      {/* The mockup has no section for these, and it needs one: a van also
        * carries units it took out of service. Badging them "Ready to install"
        * would be a lie, and they are what the tech has to run back. */}
      {toReturn.length > 0 ? (
        <>
          <SectionLabel>To return to the warehouse</SectionLabel>
          <Card>
            {toReturn.map((unit) => (
              <View key={unit.id} style={styles.serialRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.serialId}>{unit.serial_number}</Text>
                  <Text style={styles.serialStatus}>{unit.item_name}</Text>
                </View>
                <Badge value={unit.status} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>Bulk — cable &amp; consumables</SectionLabel>
      {bulkRows.length === 0 ? (
        <EmptyState title="No bulk stock in your van" />
      ) : (
        bulkRows.map((row) => (
          <Card key={row.item_id} low={row.is_low_stock === true} flat>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{row.item_name}</Text>
              <Text style={styles.itemMeta}>{row.category}</Text>
              {/* is_low_stock is COALESCEd to false server-side; test identity
                * rather than truthiness so an older API returning null cannot
                * flag every untracked item. */}
              {row.is_low_stock === true ? (
                <View style={{ marginTop: 6 }}>
                  <Badge variant="low">Reorder soon</Badge>
                </View>
              ) : null}
            </View>
            <View>
              <Text style={styles.qty}>{formatQuantity(row.quantity)}</Text>
              <Text style={styles.qtyUnit}>{row.unit_of_measure}</Text>
            </View>
          </Card>
        ))
      )}

      <SecondaryButton onPress={() => router.push('/restock')}>
        Request a restock
      </SecondaryButton>
      <SecondaryButton onPress={() => router.push('/profile')}>Profile</SecondaryButton>
    </Screen>
  );
}
