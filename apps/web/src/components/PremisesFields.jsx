import { NumberInput, Select, TextArea, TextInput } from './fields';
import { useSites } from '../hooks/useData';
import { PREMISES_TYPES, label } from '../lib/constants';

// The fields on a premises, for the add and edit dialogs.
//
// The interesting rule is that `address` is optional. In the villages this
// serves, streets have no names and houses have no numbers — what gets somebody
// back to a compound is a GPS pin, then a landmark, then the customer's name.
// So the requirement is "findable again", not "has an address", and the form
// says so rather than making the tech or the clerk discover it from a 400.
//
// Coordinates are typed here rather than captured. The field app takes a real
// fix from the handset (see GpsField); this is the back office transcribing one
// off a note, or correcting a digit.

export const emptyPremisesForm = () => ({
  address: '',
  customer_name: '',
  customer_phone: '',
  village: '',
  landmark: '',
  customer_account_id: '',
  premises_type: 'household',
  site_id: '',
  gps_lat: '',
  gps_lng: '',
  notes: '',
});

export function premisesFormFrom(premises) {
  return {
    address: premises.address ?? '',
    customer_name: premises.customer_name ?? '',
    customer_phone: premises.customer_phone ?? '',
    village: premises.village ?? '',
    landmark: premises.landmark ?? '',
    customer_account_id: premises.customer_account_id ?? '',
    premises_type: premises.premises_type ?? 'household',
    site_id: premises.site_id ? String(premises.site_id) : '',
    gps_lat: premises.gps_lat ?? '',
    gps_lng: premises.gps_lng ?? '',
    notes: premises.notes ?? '',
  };
}

// Mirrors premises_must_be_locatable, so the dialog can say what is missing
// before the request goes out.
export const premisesFormLocatable = (form) =>
  Boolean(form.address.trim() || form.landmark.trim() || String(form.gps_lat).trim());

// `nulls` decides what an emptied box means. On a create, an empty field is
// simply not sent; on an edit, it has to be sent as null to actually clear the
// value, because the API reads a missing key as "leave this alone".
export function premisesFormBody(form, { nulls = false } = {}) {
  const blank = nulls ? null : undefined;
  const text = (value) => (value.trim() === '' ? blank : value.trim());
  const number = (value) => (String(value).trim() === '' ? blank : Number(value));

  return {
    address: text(form.address),
    customer_name: text(form.customer_name),
    customer_phone: text(form.customer_phone),
    village: text(form.village),
    landmark: text(form.landmark),
    customer_account_id: text(form.customer_account_id),
    notes: text(form.notes),
    premises_type: form.premises_type,
    site_id: form.site_id === '' ? blank : Number(form.site_id),
    gps_lat: number(form.gps_lat),
    gps_lng: number(form.gps_lng),
  };
}

export function PremisesFields({ form, set, errors = {} }) {
  const sites = useSites();

  return (
    <>
      <Select
        id="site_id"
        label="Site"
        value={form.site_id}
        onChange={set('site_id')}
        placeholder="No site"
        options={(sites.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
      />
      <TextInput
        id="customer_name"
        label="Customer name"
        value={form.customer_name}
        onChange={set('customer_name')}
        placeholder="Nekesa Wanyonyi"
      />
      <TextInput
        id="customer_phone"
        label="Phone"
        value={form.customer_phone}
        onChange={set('customer_phone')}
        placeholder="07xx xxx xxx"
      />
      <TextInput
        id="village"
        label="Village"
        value={form.village}
        onChange={set('village')}
        placeholder="Nasianda"
      />
      <TextInput
        id="landmark"
        label="Landmark"
        value={form.landmark}
        onChange={set('landmark')}
        placeholder="Third compound past the borehole"
        hint="Often the only thing that finds the place. Counts instead of an address."
      />
      <Select
        id="premises_type"
        label="Kind of premises"
        value={form.premises_type}
        onChange={set('premises_type')}
        options={PREMISES_TYPES.map((type) => ({ value: type, label: label(type) }))}
      />
      <TextInput
        id="address"
        label="Address"
        value={form.address}
        onChange={set('address')}
        error={errors.address}
        hint="Optional. Most premises here have no street address."
      />
      <TextInput
        id="customer_account_id"
        label="Account"
        value={form.customer_account_id}
        onChange={set('customer_account_id')}
        hint="The customer reference this premises is billed under. Optional."
      />
      <div className="field-row">
        <NumberInput
          id="gps_lat"
          label="Latitude"
          value={form.gps_lat}
          onChange={set('gps_lat')}
          step="any"
          error={errors.gps}
        />
        <NumberInput
          id="gps_lng"
          label="Longitude"
          value={form.gps_lng}
          onChange={set('gps_lng')}
          step="any"
        />
      </div>
      <TextArea id="notes" label="Notes" value={form.notes} onChange={set('notes')} rows={2} />
    </>
  );
}
