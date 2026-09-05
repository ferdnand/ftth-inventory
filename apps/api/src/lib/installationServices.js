// Work performed at an installation.
//
// Three routes write these lines (install, replace, and the after-the-fact
// PUT), and two read them back onto premises views, so the validation and the
// SQL live here once rather than in five places.
const { badRequest } = require('./errors');
const { intId, positiveNumber, optionalString } = require('./validate');

// Accepts the `services` array a client sends and returns coerced lines.
// Missing or empty is a normal answer — most installs record no labour.
//
// body: [{ service_id, quantity?, notes? }]
function parseServiceLines(value, field = 'services') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);

  const seen = new Set();
  return value.map((line, index) => {
    const where = `${field}[${index}]`;
    if (!line || typeof line !== 'object') {
      throw badRequest(`${where} must be an object with a service_id`);
    }

    const serviceId = intId(line.service_id, `${where}.service_id`);

    // UNIQUE (installation_id, service_id) would catch this as a 409, but the
    // client sent one request and deserves to be told which line is the
    // problem — and that two runs are one line with a bigger quantity.
    if (seen.has(serviceId)) {
      throw badRequest(
        `${field} lists service_id ${serviceId} twice — combine them into one line ` +
          'with the total quantity'
      );
    }
    seen.add(serviceId);

    return {
      serviceId,
      quantity:
        line.quantity === undefined || line.quantity === null || line.quantity === ''
          ? 1
          : positiveNumber(line.quantity, `${where}.quantity`),
      notes: optionalString(line.notes, `${where}.notes`, 500),
    };
  });
}

// Replaces the lines on an installation. Must be called inside a transaction:
// the delete and the insert are one edit, and on the install path they share
// the transaction that creates the installation itself.
async function writeServiceLines(client, installationId, lines) {
  await client.query('DELETE FROM installation_services WHERE installation_id = $1', [
    installationId,
  ]);
  if (lines.length === 0) return;

  const ids = lines.map((l) => l.serviceId);

  // Check existence and is_active in one round trip, and name what is wrong.
  // A retired service must not be recorded against new work, but the rows that
  // already reference it stay readable — that is why services deactivate
  // rather than delete.
  const known = await client.query(
    'SELECT id, name, is_active FROM services WHERE id = ANY($1::int[])',
    [ids]
  );
  const byId = new Map(known.rows.map((r) => [Number(r.id), r]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw badRequest(`No service exists with id: ${missing.join(', ')}`);
  }
  const inactive = known.rows.filter((r) => !r.is_active);
  if (inactive.length > 0) {
    throw badRequest(
      `These services are no longer offered: ${inactive.map((r) => r.name).join(', ')}`
    );
  }

  const values = [];
  const params = [];
  for (const line of lines) {
    params.push(installationId, line.serviceId, line.quantity, line.notes);
    const n = params.length;
    values.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `INSERT INTO installation_services (installation_id, service_id, quantity, notes)
     VALUES ${values.join(', ')}`,
    params
  );
}

// Reads the lines for a set of installations as { [installationId]: [line] }, so
// a premises timeline of N installations costs one query rather than N.
async function serviceLinesByInstallation(queryable, installationIds) {
  if (installationIds.length === 0) return {};

  const result = await queryable.query(
    `SELECT ins.installation_id, ins.service_id, ins.quantity, ins.notes,
            s.name, s.unit_of_measure
     FROM installation_services ins
     JOIN services s ON s.id = ins.service_id
     WHERE ins.installation_id = ANY($1::int[])
     ORDER BY s.name`,
    [installationIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    const key = Number(row.installation_id);
    (grouped[key] ??= []).push({
      service_id: Number(row.service_id),
      name: row.name,
      unit_of_measure: row.unit_of_measure,
      quantity: Number(row.quantity),
      notes: row.notes,
    });
  }
  return grouped;
}

module.exports = { parseServiceLines, writeServiceLines, serviceLinesByInstallation };
