import { Text, View } from 'react-native';
import { GpsField, gpsFields } from './GpsField';
import { TextField } from './fields';
import { Pill, SectionLabel, styles } from './ui';
import { label } from '../lib/constants';
import { CONNECTION_TYPES, HOTSPOT_ARRANGEMENTS, PREMISES_TYPES } from '../lib/constants';

/**
 * Everything a tech can write down about a place, in the order they can
 * actually get it.
 *
 * The pin comes first because it is the field that always works and the one
 * that gets somebody back here. The customer's name and phone come next,
 * because that is what a tech is told when a job is called in. The address is
 * last and optional — in Bungoma and Kisumu villages there usually isn't one,
 * and pretending otherwise is what made the old form unusable.
 *
 * `value` is a plain object of the API's own field names, so `toPremisesBody`
 * below is nearly a pass-through and there is no second vocabulary to keep in
 * step. `gps` is held separately because GpsField owns its own shape.
 */
export function PremisesForm({ value, onChange, gps, onGpsChange, sites, heading = 'The place' }) {
  const set = (field) => (text) => onChange({ ...value, [field]: text });
  const isHotspot = value.connection_type === 'hotspot';

  return (
    <View>
      <SectionLabel>{heading}</SectionLabel>

      <GpsField
        value={gps}
        onChange={onGpsChange}
        hint="Stand at the gate and tap. This is what gets anyone back here later."
      />

      {sites?.length ? (
        <>
          <Text style={styles.fieldLabel}>Site</Text>
          <View style={[styles.pillRow, { marginBottom: 14 }]}>
            {sites.map((site) => (
              <Pill
                key={site.id}
                active={value.site_id === site.id}
                onPress={() =>
                  onChange({ ...value, site_id: value.site_id === site.id ? null : site.id })
                }
              >
                {site.name}
              </Pill>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.fieldLabel}>Connection</Text>
      <View style={[styles.pillRow, { marginBottom: 14 }]}>
        {CONNECTION_TYPES.map((type) => (
          <Pill
            key={type}
            active={value.connection_type === type}
            onPress={() =>
              onChange({
                ...value,
                connection_type: type,
                // Only a hotspot has one.
                hotspot_arrangement: type === 'hotspot' ? value.hotspot_arrangement : null,
              })
            }
          >
            {label(type)}
          </Pill>
        ))}
      </View>
      {isHotspot ? (
        <>
          <Text style={styles.fieldLabel}>What does the host get?</Text>
          <View style={[styles.pillRow, { marginBottom: 14 }]}>
            {HOTSPOT_ARRANGEMENTS.map((arrangement) => (
              <Pill
                key={arrangement}
                active={value.hotspot_arrangement === arrangement}
                onPress={() => onChange({ ...value, hotspot_arrangement: arrangement })}
              >
                {arrangement === 'token' ? 'A token (we pay)' : 'A voucher (we give)'}
              </Pill>
            ))}
          </View>
        </>
      ) : null}

      <TextField
        label={isHotspot ? 'Contact person' : 'Customer name'}
        value={value.customer_name}
        onChangeText={set('customer_name')}
        placeholder="Nekesa Wanyonyi"
        autoCapitalize="words"
      />
      <TextField
        label={isHotspot ? 'Contact phone' : 'Phone'}
        value={value.customer_phone}
        onChangeText={set('customer_phone')}
        placeholder="07xx xxx xxx"
        keyboardType="phone-pad"
      />
      <TextField
        label="Village"
        value={value.village}
        onChangeText={set('village')}
        placeholder="Nasianda"
        autoCapitalize="words"
      />
      <TextField
        label="Landmark"
        value={value.landmark}
        onChangeText={set('landmark')}
        placeholder="Third compound past the borehole"
      />

      <Text style={styles.fieldLabel}>Kind of premises</Text>
      <View style={[styles.pillRow, { marginBottom: 14 }]}>
        {PREMISES_TYPES.map((type) => (
          <Pill
            key={type}
            active={value.premises_type === type}
            onPress={() => onChange({ ...value, premises_type: type })}
          >
            {label(type)}
          </Pill>
        ))}
      </View>

      <TextField
        label="Address (if there is one)"
        value={value.address}
        onChangeText={set('address')}
        placeholder="14B Kanduyi Road"
        autoCapitalize="words"
      />
      <TextField
        label="Account number"
        value={value.customer_account_id}
        onChangeText={set('customer_account_id')}
        placeholder="KE-77291"
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {/* The API enforces this and returns the same sentence; saying it up
        * front stops the tech filling the form in and then being refused. */}
      <Text style={styles.hint}>
        A premises has to be findable again, so give a pin, a landmark, or an address. Everything
        else is a bonus.
      </Text>
    </View>
  );
}

// A single household in its own compound is the common case here, so it is what
// the form starts on.
export const emptyPremises = () => ({
  customer_name: '',
  customer_phone: '',
  village: '',
  landmark: '',
  address: '',
  customer_account_id: '',
  premises_type: 'household',
  connection_type: 'pppoe',
  hotspot_arrangement: null,
  site_id: null,
});

// Is there enough here to save? Mirrors premises_must_be_locatable.
export const premisesLocatable = (value, gps) =>
  (Boolean(gps) || Boolean(value.address?.trim()) || Boolean(value.landmark?.trim())) &&
  // A hotspot has to say what its host gets; the API refuses one that does not.
  (value.connection_type !== 'hotspot' || Boolean(value.hotspot_arrangement));

// The form, as the API's premises body. Blank text fields are dropped rather
// than sent as '' — the API reads an empty string as "not given", but leaving
// them out says the same thing without relying on that.
export function toPremisesBody(value, gps) {
  const text = (v) => (v?.trim() ? v.trim() : undefined);
  return {
    customer_name: text(value.customer_name),
    customer_phone: text(value.customer_phone),
    village: text(value.village),
    landmark: text(value.landmark),
    address: text(value.address),
    customer_account_id: text(value.customer_account_id),
    premises_type: value.premises_type,
    connection_type: value.connection_type,
    hotspot_arrangement:
      value.connection_type === 'hotspot' ? (value.hotspot_arrangement ?? undefined) : undefined,
    site_id: value.site_id ?? undefined,
    ...gpsFields(gps),
  };
}
