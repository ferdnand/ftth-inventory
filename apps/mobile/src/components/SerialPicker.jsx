import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Card, EmptyState, SectionLabel, styles } from './ui';
import { SearchBar } from './fields';
import { colors, fonts } from '../theme';
import { groupSerialized } from '../lib/groupSerialized';

/**
 * Picks ONE serialized unit out of the tech's own van.
 *
 * This is the reconciliation of the mockup against the data model. The mockup's
 * replace screen (mobile_screens.html:481-488) has free-text "serial number"
 * and "MAC address" inputs, but POST /api/installations/:id/replace requires a
 * `new_item_instance_id` — and no endpoint turns an arbitrary typed serial into
 * one.
 *
 * So the serial field is a FILTER over the van's own units rather than free
 * text. Typing (or later scanning) a serial narrows the list; selecting a unit
 * supplies its id. That is faithful to the mockup's interaction while being
 * honest about the rule underneath: you can only install a unit that already
 * exists and is in your van. It is also the correct authorization posture —
 * a tech should not be able to name a unit they are not carrying.
 *
 * SCANNING HOOKS IN HERE: add an expo-camera barcode button beside the search
 * bar and feed the decoded string into `setFilter`. Nothing else changes.
 */
export function SerialPicker({ rows, selectedId, onSelect, emptyMessage }) {
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => groupSerialized(rows ?? []), [rows]);
  const term = filter.trim().toLowerCase();

  const visible = groups
    .map((group) => ({
      ...group,
      // Only units that can actually be installed. A faulty unit in the van is
      // not a candidate, and offering it would produce a 409 from the API.
      pickable: group.installable.filter(
        (unit) =>
          !term ||
          unit.serial_number.toLowerCase().includes(term) ||
          (unit.mac_address ?? '').toLowerCase().includes(term)
      ),
    }))
    .filter((group) => group.pickable.length > 0);

  const nothingAtAll = groups.every((g) => g.installable.length === 0);

  return (
    <View>
      <SearchBar
        value={filter}
        onChangeText={setFilter}
        placeholder="Type or scan a serial number"
      />

      {nothingAtAll ? (
        <EmptyState title="No units ready to install">
          {emptyMessage ??
            'Your van has nothing installable right now. Raise a restock request or check with the warehouse.'}
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="That serial isn’t in your van">
          Only units already in your van can be installed. Raise a restock request or contact the
          warehouse.
        </EmptyState>
      ) : (
        visible.map((group) => (
          <Card key={group.item_id}>
            <Text style={styles.itemName}>{group.item_name}</Text>
            <Text style={styles.itemMeta}>
              {[group.manufacturer, group.model].filter(Boolean).join(' ') || group.category}
            </Text>

            <View style={{ marginTop: 8 }}>
              {group.pickable.map((unit) => {
                const selected = unit.id === selectedId;
                return (
                  <Pressable
                    key={unit.id}
                    onPress={() => onSelect(unit)}
                    style={[
                      styles.resultItem,
                      { marginBottom: 6 },
                      selected && styles.resultItemSelected,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 }}>
                          {unit.serial_number}
                        </Text>
                        <Text style={styles.serialStatus}>
                          {unit.mac_address ?? 'no MAC recorded'}
                        </Text>
                      </View>
                      {selected ? <Badge variant="installed">Selected</Badge> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
