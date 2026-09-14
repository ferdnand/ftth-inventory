// Capturing a premises.
//
// Two callers create one: POST /api/premises, and POST /api/work-orders when a
// tech opens a job at a place nobody has recorded yet. The rules are here once
// rather than in both, because the interesting rule is not obvious.
//
// A premises does NOT need an address. In the villages this serves, streets
// have no names and houses have no numbers, so "14B Ngong Road" is a Nairobi
// idea. What actually gets a tech back to the same compound is a GPS fix, and
// after that a landmark and the customer's name. So the rule is: you must be
// able to find it again — by description, by landmark, or by coordinates — and
// which of those you have is up to what you could get on the day.
//
// 011_sites_and_premises_capture.sql enforces the same thing as
// premises_must_be_locatable. This produces the sentence a person can act on.
const { badRequest } = require('./errors');
const {
  optionalIntId,
  optionalString,
  optionalNumber,
  optionalDate,
  oneOf,
} = require('./validate');
const { PREMISES_TYPES } = require('./constants');

// Everything a client needs to show a premises, with the site name resolved.
const PREMISES_SELECT = `
  SELECT cp.*, site.name AS site_name, capturer.name AS created_by_name
  FROM customer_premises cp
  LEFT JOIN locations site ON site.id = cp.site_id
  LEFT JOIN users capturer ON capturer.id = cp.created_by
`;

// Every column a client may set, with how to read it. Order matters only in
// that the INSERT and the PATCH both walk this list, so a new field is one row
// here and nothing else.
const FIELDS = {
  address: (v) => optionalString(v, 'address', 500),
  customer_account_id: (v) => optionalString(v, 'customer_account_id', 100),
  customer_name: (v) => optionalString(v, 'customer_name', 200),
  customer_phone: (v) => optionalString(v, 'customer_phone', 40),
  village: (v) => optionalString(v, 'village', 200),
  landmark: (v) => optionalString(v, 'landmark', 300),
  notes: (v) => optionalString(v, 'notes', 1000),
  premises_type: (v) => oneOf(v, PREMISES_TYPES, 'premises_type'),
  site_id: (v) => optionalIntId(v, 'site_id'),
  gps_lat: (v) => optionalNumber(v, 'gps_lat'),
  gps_lng: (v) => optionalNumber(v, 'gps_lng'),
  gps_accuracy_m: (v) => optionalNumber(v, 'gps_accuracy_m'),
  gps_captured_at: (v) => optionalDate(v, 'gps_captured_at'),
};

// Reads whichever of the fields above the body actually mentions. Absent and
// explicitly null are different: a PATCH that sends nothing for `village`
// leaves it alone, one that sends null clears it.
function parsePremisesFields(body) {
  const values = {};
  for (const [field, read] of Object.entries(FIELDS)) {
    if (body?.[field] !== undefined) values[field] = read(body[field]);
  }
  return values;
}

function assertGpsCoherent(lat, lng, accuracy) {
  if ((lat === null) !== (lng === null)) {
    throw badRequest('gps_lat and gps_lng must be sent together — half a fix locates nothing');
  }
  if (lat !== null && (lat < -90 || lat > 90)) {
    throw badRequest('gps_lat must be between -90 and 90');
  }
  if (lng !== null && (lng < -180 || lng > 180)) {
    throw badRequest('gps_lng must be between -180 and 180');
  }
  if (accuracy !== null && accuracy !== undefined && accuracy < 0) {
    throw badRequest('gps_accuracy_m cannot be negative');
  }
}

function assertLocatable({ address, landmark, gps_lat: lat, gps_lng: lng }) {
  if (address || landmark || (lat !== null && lat !== undefined)) return;
  throw badRequest(
    'A premises has to be findable again: give an address, a landmark, or a GPS fix'
  );
}

// A site is a `location` of type 'site' — Bungoma or Kisumu. The FK only says
// it is some location, so without this a premises could be filed under a tech's
// van and every per-site figure would be wrong.
async function assertIsSite(queryable, siteId) {
  if (siteId === null || siteId === undefined) return;
  const result = await queryable.query('SELECT id, name, type FROM locations WHERE id = $1', [
    siteId,
  ]);
  const location = result.rows[0];
  if (!location) throw badRequest(`No location exists with id ${siteId}`);
  if (location.type !== 'site') {
    throw badRequest(`${location.name} is a ${location.type}, not a site`);
  }
}

// Creates the row. `capturedBy` is the acting user: on a new premises that is
// almost always the tech standing in the compound, and knowing who wrote it
// down is what makes a doubtful record checkable later.
async function insertPremises(queryable, body, capturedBy) {
  const values = parsePremisesFields(body);

  assertGpsCoherent(
    values.gps_lat ?? null,
    values.gps_lng ?? null,
    values.gps_accuracy_m ?? null
  );
  assertLocatable(values);
  await assertIsSite(queryable, values.site_id ?? null);

  // A fix with no capture time is assumed to have been taken now, which is true
  // whenever a tech taps "use my location". A client that read a cached
  // position should say when it was read.
  if (values.gps_lat !== undefined && values.gps_lat !== null && !values.gps_captured_at) {
    values.gps_captured_at = new Date().toISOString();
  }

  values.created_by = capturedBy;

  const columns = Object.keys(values);
  const params = columns.map((c) => values[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`);

  const inserted = await queryable.query(
    `INSERT INTO customer_premises (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING id`,
    params
  );

  // Read it back through the same select every other route uses, so a client
  // that creates a premises and renders it immediately gets the site name and
  // the label rather than a row that is a different shape from the GET.
  // Same queryable, so this still works inside the job-creation transaction.
  const result = await queryable.query(`${PREMISES_SELECT} WHERE cp.id = $1`, [
    inserted.rows[0].id,
  ]);
  return result.rows[0];
}

// What to call the place, when `address` may be null.
//
// The clients each need this for a list row or a screen title, and getting it
// from three code bases separately is how two of them end up showing "Premises
// 41" for a house that has a perfectly good landmark. The API sends the label.
function premisesLabel(row) {
  if (!row) return null;
  const named = row.address || row.landmark || row.customer_name;
  if (named) {
    // A landmark on its own is ambiguous across villages: "next to the school"
    // is every village. Qualify it where there is a village to qualify it with.
    return row.village && named !== row.village ? `${named}, ${row.village}` : named;
  }
  if (row.village) return row.village;
  if (row.gps_lat !== null && row.gps_lat !== undefined) {
    return `Pin at ${Number(row.gps_lat).toFixed(5)}, ${Number(row.gps_lng).toFixed(5)}`;
  }
  return `Premises ${row.id}`;
}

// Adds the label and turns the GPS numerics into numbers. pg hands NUMERIC back
// as a string, and a coordinate compared or mapped as a string is a bug waiting
// to happen in whichever client forgets.
function shapePremises(row) {
  if (!row) return null;
  return {
    ...row,
    gps_lat: row.gps_lat === null ? null : Number(row.gps_lat),
    gps_lng: row.gps_lng === null ? null : Number(row.gps_lng),
    gps_accuracy_m: row.gps_accuracy_m === null ? null : Number(row.gps_accuracy_m),
    label: premisesLabel(row),
  };
}

module.exports = {
  FIELDS,
  PREMISES_SELECT,
  parsePremisesFields,
  assertGpsCoherent,
  assertLocatable,
  assertIsSite,
  insertPremises,
  premisesLabel,
  shapePremises,
};
