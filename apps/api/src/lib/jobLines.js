// What a job used, did, and cost.
//
// Three kinds of line hang off a job — materials, labour, expenses — and all
// three are written the same way: the client sends the COMPLETE list and it
// replaces what was there. That is deliberate. A tech on a dying signal taps
// Save twice; with a replace, the second tap is a no-op instead of a double
// entry, so none of these need an idempotency key.
//
// Materials are the exception to "just replace it", because they move real
// stock. Replacing a 40 m line with 20 m has to put 20 m back in the van it
// came out of, so writeMaterialLines works out the difference per item and
// moves only that. See the delta loop below.
//
// Money is KES with two decimals throughout (013_job_costing.sql). Rates are
// snapshotted onto the line when it is written rather than joined from the
// catalog, so re-pricing next quarter cannot rewrite what last quarter cost.
const { badRequest, forbidden } = require('./errors');
const { intId, positiveNumber, optionalNumber, optionalString, oneOf } = require('./validate');
const { JOB_EXPENSE_CATEGORIES } = require('./constants');
const { applyMove } = require('./stock');
const { isFieldTech } = require('../middleware/auth');

// Shared shape check for a list of lines. Returns [] for a missing list, which
// is a normal answer — most jobs record no expenses at all.
function parseLines(value, field, parseOne) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  return value.map((line, index) => {
    if (!line || typeof line !== 'object') {
      throw badRequest(`${field}[${index}] must be an object`);
    }
    return parseOne(line, `${field}[${index}]`);
  });
}

// Rejects a second line for the same catalog row. UNIQUE (work_order_id, *_id)
// would catch it as a 409, but the client sent one request and deserves to be
// told which line is wrong — and that two runs are one line with a bigger
// quantity, not two lines.
function assertDistinct(lines, key, field, what) {
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line[key])) {
      throw badRequest(
        `${field} lists ${what} ${line[key]} twice — combine them into one line ` +
          'with the total quantity'
      );
    }
    seen.add(line[key]);
  }
}

// A blank quantity means one — a flat-rate job is always 1, and a half-typed
// number must never submit as zero.
function blankIsOne(value, field) {
  if (value === undefined || value === null || value === '') return 1;
  return positiveNumber(value, field);
}

function nonNegative(value, field) {
  const n = optionalNumber(value, field);
  if (n !== null && n < 0) throw badRequest(`${field} cannot be negative`);
  return n;
}

// Sums of NUMERIC come back through JS floats; 40 * 12.5 + 0.1 should not
// report as 500.10000000000002 on a costing screen.
const round2 = (n) => Math.round(n * 100) / 100;

const money = (value) => (value === null || value === undefined ? null : Number(value));

// A line total is null, not zero, when the line is unpriced: "we have not
// priced this" and "this was free" are different facts.
const lineTotal = (rate, quantity) =>
  rate === null || rate === undefined ? null : round2(Number(rate) * Number(quantity));

// ------------------------------------------------------------
// Labour
// ------------------------------------------------------------

// body: [{ service_id, quantity?, unit_rate?, notes? }]
function parseServiceLines(value, field = 'services') {
  const lines = parseLines(value, field, (line, where) => ({
    serviceId: intId(line.service_id, `${where}.service_id`),
    quantity: blankIsOne(line.quantity, `${where}.quantity`),
    unitRate: nonNegative(line.unit_rate, `${where}.unit_rate`),
    notes: optionalString(line.notes, `${where}.notes`, 500),
  }));
  assertDistinct(lines, 'serviceId', field, 'service_id');
  return lines;
}

// Replaces the labour lines on a job. Must run inside a transaction: the delete
// and the insert are one edit.
async function writeServiceLines(client, jobId, lines) {
  await client.query('DELETE FROM job_services WHERE work_order_id = $1', [jobId]);
  if (lines.length === 0) return;

  const ids = lines.map((l) => l.serviceId);

  // Existence, is_active and the standard rate in one round trip. A retired
  // service must not be recorded against new work, but rows that already
  // reference it stay readable — that is why services deactivate rather than
  // delete.
  const known = await client.query(
    'SELECT id, name, is_active, unit_rate FROM services WHERE id = ANY($1::int[])',
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
    // An explicit rate wins; otherwise take the catalog's, which may itself be
    // null when nothing has been priced yet.
    const rate = line.unitRate ?? byId.get(line.serviceId).unit_rate ?? null;
    params.push(jobId, line.serviceId, line.quantity, rate, line.notes);
    const n = params.length;
    values.push(`($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `INSERT INTO job_services (work_order_id, service_id, quantity, unit_rate, notes)
     VALUES ${values.join(', ')}`,
    params
  );
}

function toServiceLine(row) {
  return {
    service_id: Number(row.service_id),
    name: row.name,
    unit_of_measure: row.unit_of_measure,
    quantity: Number(row.quantity),
    unit_rate: money(row.unit_rate),
    line_total: lineTotal(row.unit_rate, row.quantity),
    notes: row.notes,
  };
}

// Reads labour for a set of jobs as { [jobId]: [line] }, so a list of N jobs
// costs one query rather than N.
async function serviceLinesByJob(queryable, jobIds) {
  if (jobIds.length === 0) return {};
  const result = await queryable.query(
    `SELECT js.work_order_id, js.service_id, js.quantity, js.unit_rate, js.notes,
            s.name, s.unit_of_measure
     FROM job_services js
     JOIN services s ON s.id = js.service_id
     WHERE js.work_order_id = ANY($1::int[])
     ORDER BY s.name`,
    [jobIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    (grouped[Number(row.work_order_id)] ??= []).push(toServiceLine(row));
  }
  return grouped;
}

// The same lines, keyed by installation instead of by job.
//
// Labour moved onto the job in 013, but the premises views still ask "what work
// was done on this visit" and answer it per installation. 012 made every
// installation belong to exactly one job, so this is a lookup through
// work_order_id — the API shape those clients read did not have to change.
async function serviceLinesByInstallation(queryable, installationIds) {
  if (installationIds.length === 0) return {};
  const result = await queryable.query(
    `SELECT inst.id AS installation_id, js.service_id, js.quantity, js.unit_rate, js.notes,
            s.name, s.unit_of_measure
     FROM installations inst
     JOIN job_services js ON js.work_order_id = inst.work_order_id
     JOIN services s ON s.id = js.service_id
     WHERE inst.id = ANY($1::int[])
     ORDER BY s.name`,
    [installationIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    (grouped[Number(row.installation_id)] ??= []).push(toServiceLine(row));
  }
  return grouped;
}

// ------------------------------------------------------------
// Materials
// ------------------------------------------------------------

// body: [{ item_id, quantity, unit_cost?, notes? }]
function parseMaterialLines(value, field = 'materials') {
  const lines = parseLines(value, field, (line, where) => ({
    itemId: intId(line.item_id, `${where}.item_id`),
    quantity: positiveNumber(line.quantity, `${where}.quantity`),
    unitCost: nonNegative(line.unit_cost, `${where}.unit_cost`),
    notes: optionalString(line.notes, `${where}.notes`, 500),
  }));
  assertDistinct(lines, 'itemId', field, 'item_id');
  return lines;
}

// Checks every item on the list and resolves the cost each line will carry.
async function priceMaterialLines(client, lines) {
  if (lines.length === 0) return;

  const ids = lines.map((l) => l.itemId);
  const known = await client.query(
    `SELECT id, name, is_active, tracking_type, unit_cost
     FROM items WHERE id = ANY($1::int[])`,
    [ids]
  );
  const byId = new Map(known.rows.map((r) => [Number(r.id), r]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw badRequest(`No item exists with id: ${missing.join(', ')}`);
  }

  // The database enforces this too (trg_job_material_is_bulk). Saying it here
  // names the item instead of surfacing a constraint name, and points at the
  // route that does handle a router.
  const serialized = known.rows.filter((r) => r.tracking_type !== 'bulk');
  if (serialized.length > 0) {
    const names = serialized.map((r) => r.name).join(', ');
    const one = serialized.length === 1;
    throw badRequest(
      `${names} ${one ? 'is' : 'are'} serialized — record ${
        one ? 'it' : 'them'
      } by installing the unit, not as a material`
    );
  }

  const inactive = known.rows.filter((r) => !r.is_active);
  if (inactive.length > 0) {
    throw badRequest(
      `These items are no longer in the catalog: ${inactive.map((r) => r.name).join(', ')}`
    );
  }

  for (const line of lines) {
    line.resolvedCost = line.unitCost ?? money(byId.get(line.itemId).unit_cost);
  }
}

// Replaces the material lines on a job AND moves the difference in stock.
//
// `defaultLocationId` is where NEW lines are drawn from — the job's site unless
// the caller named another source. A line that already exists keeps the location
// it was first drawn from, so a correction returns the difference to the stock
// that supplied it rather than to wherever the person editing is working now.
//
// `jobSiteId` widens what a field tech may touch: their own van, plus the stock
// at the job's site. Nothing else.
async function writeMaterialLines(
  client,
  { jobId, lines, defaultLocationId, jobSiteId = null, user }
) {
  const existing = await client.query(
    `SELECT item_id, quantity, from_location_id
     FROM job_materials WHERE work_order_id = $1
     ORDER BY item_id
     FOR UPDATE`,
    [jobId]
  );
  const before = new Map(
    existing.rows.map((r) => [
      Number(r.item_id),
      { quantity: Number(r.quantity), locationId: Number(r.from_location_id) },
    ])
  );

  await priceMaterialLines(client, lines);

  // --- Move the difference ------------------------------------------------
  // Every item on either side of the edit, in id order so two concurrent edits
  // touching the same pair of items cannot deadlock.
  const after = new Map(lines.map((l) => [l.itemId, l]));
  const touched = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);

  for (const itemId of touched) {
    const was = before.get(itemId);
    const now = after.get(itemId);
    const sourceId = was ? was.locationId : defaultLocationId;

    // A tech may only draw down, or top back up, their own van or the stock at
    // this job's site.
    const techMayUse = [user.assigned_location_id, jobSiteId]
      .filter(Boolean)
      .map(Number);
    if (isFieldTech(user) && !techMayUse.includes(Number(sourceId))) {
      throw forbidden(
        'Some of these materials were drawn from stock you cannot use. ' +
          'Ask the warehouse to correct that line.'
      );
    }

    const delta = (now ? now.quantity : 0) - (was ? was.quantity : 0);
    if (delta === 0) continue;

    if (delta > 0) {
      await applyMove(client, { itemId, fromLocationId: sourceId, quantity: delta });
      await recordMaterialMovement(client, {
        itemId,
        jobId,
        userId: user.id,
        quantity: delta,
        fromLocationId: sourceId,
        toLocationId: null,
        type: 'install',
        note: `Used on job ${jobId}`,
      });
    } else {
      await applyMove(client, { itemId, toLocationId: sourceId, quantity: -delta });
      await recordMaterialMovement(client, {
        itemId,
        jobId,
        userId: user.id,
        quantity: -delta,
        fromLocationId: null,
        toLocationId: sourceId,
        type: 'return',
        note: `Correction to job ${jobId} — material put back`,
      });
    }
  }

  // --- Rewrite the lines --------------------------------------------------
  await client.query('DELETE FROM job_materials WHERE work_order_id = $1', [jobId]);
  if (lines.length === 0) return;

  const values = [];
  const params = [];
  for (const line of lines) {
    const sourceId = before.get(line.itemId)?.locationId ?? defaultLocationId;
    params.push(
      jobId,
      line.itemId,
      line.quantity,
      line.resolvedCost,
      sourceId,
      line.notes,
      user.id
    );
    const n = params.length;
    values.push(`($${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `INSERT INTO job_materials
       (work_order_id, item_id, quantity, unit_cost, from_location_id, notes, recorded_by)
     VALUES ${values.join(', ')}`,
    params
  );
}

// The audit row for a material movement. 'install' is the honest type for stock
// consumed on a job — it left the van and went into a customer's premises, with
// no destination location because a premises is not a `location`. It is also
// what GET /api/reports/consumption already counts.
async function recordMaterialMovement(
  client,
  { itemId, jobId, userId, quantity, fromLocationId, toLocationId, type, note }
) {
  await client.query(
    `INSERT INTO transactions
       (item_id, quantity, from_location_id, to_location_id, type, work_order_id,
        performed_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [itemId, quantity, fromLocationId, toLocationId, type, jobId, userId, note]
  );
}

async function materialLinesByJob(queryable, jobIds) {
  if (jobIds.length === 0) return {};
  const result = await queryable.query(
    `SELECT jm.work_order_id, jm.item_id, jm.quantity, jm.unit_cost, jm.notes,
            jm.from_location_id, i.name, i.category, i.unit_of_measure,
            l.name AS from_location_name
     FROM job_materials jm
     JOIN items i ON i.id = jm.item_id
     LEFT JOIN locations l ON l.id = jm.from_location_id
     WHERE jm.work_order_id = ANY($1::int[])
     ORDER BY i.category, i.name`,
    [jobIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    (grouped[Number(row.work_order_id)] ??= []).push({
      item_id: Number(row.item_id),
      name: row.name,
      category: row.category,
      unit_of_measure: row.unit_of_measure,
      quantity: Number(row.quantity),
      unit_cost: money(row.unit_cost),
      line_total: lineTotal(row.unit_cost, row.quantity),
      from_location_id: Number(row.from_location_id),
      from_location_name: row.from_location_name,
      notes: row.notes,
    });
  }
  return grouped;
}

// ------------------------------------------------------------
// Expenses
// ------------------------------------------------------------

// body: [{ category, amount, description? }]
//
// No uniqueness rule here, unlike materials and labour: two boda fares on one
// job are two facts, not a double entry.
function parseExpenseLines(value, field = 'expenses') {
  return parseLines(value, field, (line, where) => ({
    category: oneOf(line.category, JOB_EXPENSE_CATEGORIES, `${where}.category`),
    amount: positiveNumber(line.amount, `${where}.amount`),
    description: optionalString(line.description, `${where}.description`, 500),
  }));
}

async function writeExpenseLines(client, jobId, lines, userId) {
  await client.query('DELETE FROM job_expenses WHERE work_order_id = $1', [jobId]);
  if (lines.length === 0) return;

  const values = [];
  const params = [];
  for (const line of lines) {
    params.push(jobId, line.category, line.amount, line.description, userId);
    const n = params.length;
    values.push(`($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `INSERT INTO job_expenses (work_order_id, category, amount, description, recorded_by)
     VALUES ${values.join(', ')}`,
    params
  );
}

async function expenseLinesByJob(queryable, jobIds) {
  if (jobIds.length === 0) return {};
  const result = await queryable.query(
    `SELECT je.work_order_id, je.id, je.category, je.amount, je.description, je.created_at,
            u.name AS recorded_by_name
     FROM job_expenses je
     LEFT JOIN users u ON u.id = je.recorded_by
     WHERE je.work_order_id = ANY($1::int[])
     ORDER BY je.category, je.id`,
    [jobIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    (grouped[Number(row.work_order_id)] ??= []).push({
      id: Number(row.id),
      category: row.category,
      amount: Number(row.amount),
      description: row.description,
      recorded_by_name: row.recorded_by_name,
      created_at: row.created_at,
    });
  }
  return grouped;
}

// ------------------------------------------------------------
// Cost roll-up
// ------------------------------------------------------------

// Four buckets, kept separate because they answer different questions and
// because any of them can be unpriced.
//
// `unpriced_lines` counts the lines carrying no rate. Without it a total of
// 1,200 reads as the whole cost of the job when it might be the cost of the one
// line somebody has got round to pricing — which is worse than no number.
//
// Hardware is priced from items.unit_cost at read time rather than snapshotted,
// because `installations` records no cost of its own. It is named as its own
// bucket in the response so nobody mistakes it for a figure agreed on the day.
async function jobCostSummary(queryable, jobIds) {
  if (jobIds.length === 0) return {};

  const result = await queryable.query(
    `WITH jobs AS (SELECT unnest($1::int[]) AS id),
     materials AS (
       SELECT jm.work_order_id AS id,
              SUM(jm.quantity * coalesce(jm.unit_cost, 0)) AS total,
              COUNT(*) FILTER (WHERE jm.unit_cost IS NULL)::int AS unpriced,
              COUNT(*)::int AS lines
         FROM job_materials jm GROUP BY jm.work_order_id
     ),
     labour AS (
       SELECT js.work_order_id AS id,
              SUM(js.quantity * coalesce(js.unit_rate, 0)) AS total,
              COUNT(*) FILTER (WHERE js.unit_rate IS NULL)::int AS unpriced,
              COUNT(*)::int AS lines
         FROM job_services js GROUP BY js.work_order_id
     ),
     expenses AS (
       SELECT je.work_order_id AS id, SUM(je.amount) AS total, COUNT(*)::int AS lines
         FROM job_expenses je GROUP BY je.work_order_id
     ),
     hardware AS (
       SELECT inst.work_order_id AS id,
              SUM(coalesce(i.unit_cost, 0)) AS total,
              COUNT(*) FILTER (WHERE i.unit_cost IS NULL)::int AS unpriced,
              COUNT(*)::int AS lines
         FROM installations inst
         JOIN item_instances ii ON ii.id = inst.item_instance_id
         JOIN items i ON i.id = ii.item_id
        GROUP BY inst.work_order_id
     )
     SELECT j.id,
            coalesce(m.total, 0)    AS materials_total,
            coalesce(m.unpriced, 0) AS materials_unpriced,
            coalesce(m.lines, 0)    AS materials_lines,
            coalesce(l.total, 0)    AS labour_total,
            coalesce(l.unpriced, 0) AS labour_unpriced,
            coalesce(l.lines, 0)    AS labour_lines,
            coalesce(e.total, 0)    AS expenses_total,
            coalesce(e.lines, 0)    AS expenses_lines,
            coalesce(h.total, 0)    AS hardware_total,
            coalesce(h.unpriced, 0) AS hardware_unpriced,
            coalesce(h.lines, 0)    AS hardware_lines
       FROM jobs j
       LEFT JOIN materials m ON m.id = j.id
       LEFT JOIN labour    l ON l.id = j.id
       LEFT JOIN expenses  e ON e.id = j.id
       LEFT JOIN hardware  h ON h.id = j.id`,
    [jobIds]
  );

  const summaries = {};
  for (const row of result.rows) {
    const materials = round2(Number(row.materials_total));
    const labour = round2(Number(row.labour_total));
    const expenses = round2(Number(row.expenses_total));
    const hardware = round2(Number(row.hardware_total));

    summaries[Number(row.id)] = {
      currency: 'KES',
      materials_total: materials,
      labour_total: labour,
      expenses_total: expenses,
      hardware_total: hardware,
      total: round2(materials + labour + expenses + hardware),
      // A total with unpriced_lines > 0 is a floor, not the cost.
      unpriced_lines:
        Number(row.materials_unpriced) +
        Number(row.labour_unpriced) +
        Number(row.hardware_unpriced),
      line_counts: {
        materials: Number(row.materials_lines),
        labour: Number(row.labour_lines),
        expenses: Number(row.expenses_lines),
        hardware: Number(row.hardware_lines),
      },
    };
  }
  return summaries;
}

module.exports = {
  parseServiceLines,
  writeServiceLines,
  serviceLinesByJob,
  serviceLinesByInstallation,
  parseMaterialLines,
  writeMaterialLines,
  materialLinesByJob,
  parseExpenseLines,
  writeExpenseLines,
  expenseLinesByJob,
  jobCostSummary,
};
