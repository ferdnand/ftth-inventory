import { Pressable, Text, View } from 'react-native';
import { Badge, Card, EmptyState, styles } from './ui';
import { TextField } from './fields';
import { colors } from '../theme';

/**
 * Picks the labour performed on this visit, alongside the hardware.
 *
 * `value` is a map of { [serviceId]: { quantity, notes } } rather than an array,
 * so toggling one service cannot reorder or disturb the others mid-edit. The
 * caller turns it into the API's `services: [{ service_id, quantity, notes }]`
 * with `toServiceLines` below.
 *
 * Flat-rate work ('job') is always one per visit, so selecting it is the whole
 * interaction — no keyboard. Only measured work ('meter') asks for a number,
 * which matters on a phone in the field.
 */
export function ServicePicker({ services, value, onChange }) {
  if (!services || services.length === 0) {
    return (
      <EmptyState title="No services set up">
        The warehouse adds these under Catalog → Services on the dashboard.
      </EmptyState>
    );
  }

  const toggle = (service) => {
    const next = { ...value };
    if (next[service.id]) delete next[service.id];
    else next[service.id] = { quantity: '1', notes: '' };
    onChange(next);
  };

  const edit = (id, key, text) =>
    onChange({ ...value, [id]: { ...value[id], [key]: text } });

  return (
    <View>
      {services.map((service) => {
        const line = value[service.id];
        const measured = service.unit_of_measure !== 'job';
        return (
          <Card key={service.id}>
            <Pressable
              onPress={() => toggle(service)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: Boolean(line) }}
              style={[styles.resultItem, line && styles.resultItemSelected]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{service.name}</Text>
                  <Text style={styles.serialStatus}>
                    {measured ? `Charged per ${service.unit_of_measure}` : 'Flat rate per visit'}
                    {service.description ? ` · ${service.description}` : ''}
                  </Text>
                </View>
                {line ? <Badge variant="installed">Doing</Badge> : null}
              </View>
            </Pressable>

            {line ? (
              <View style={{ marginTop: 10 }}>
                {measured ? (
                  <TextField
                    label={`How much? (${service.unit_of_measure})`}
                    value={line.quantity}
                    onChangeText={(text) => edit(service.id, 'quantity', text)}
                    keyboardType="numeric"
                    placeholder="40"
                    placeholderTextColor={colors.meta}
                  />
                ) : null}
                <TextField
                  label="Notes"
                  value={line.notes}
                  onChangeText={(text) => edit(service.id, 'notes', text)}
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

// The picker's map, as the API's array. Quantity is text while it is being
// typed — an empty box means "1", not zero, so a half-typed number never
// submits a value the API would reject.
export function toServiceLines(value) {
  return Object.entries(value).map(([serviceId, line]) => ({
    service_id: Number(serviceId),
    quantity: line.quantity === '' ? 1 : Number(line.quantity),
    notes: line.notes?.trim() ? line.notes.trim() : undefined,
  }));
}

// Guards the submit button: a measured service with a blank or non-numeric
// amount is the one way this form can be wrong before it is sent.
export function serviceLinesReady(value, services) {
  const byId = new Map((services ?? []).map((s) => [s.id, s]));
  return Object.entries(value).every(([serviceId, line]) => {
    const service = byId.get(Number(serviceId));
    if (!service || service.unit_of_measure === 'job') return true;
    const n = Number(line.quantity);
    return Number.isFinite(n) && n > 0;
  });
}
