// Attaching a premises to a job that was opened without one.
//
// A new install can be dispatched before anybody knows where it is (017). The
// premises is filled in later, from one of two places: the job being edited, or
// a router being installed against it. Both go through here so the rules are the
// same: the job must still have no premises, the premises must be at the job's
// site (or have none yet, in which case it is filed under the job's), and a
// former client cannot be attached.
const { badRequest, conflict, notFound } = require('./errors');

// `job` is { id, site_id, customer_premises_id }. Runs inside the caller's
// transaction, so the job and premises rows stay locked until it commits.
async function attachPremisesToJob(client, job, premisesId) {
  if (job.customer_premises_id) {
    throw conflict(`Job ${job.id} already has a premises`);
  }

  const found = await client.query(
    `SELECT cp.id, cp.site_id, cp.is_active, site.name AS site_name
     FROM customer_premises cp
     LEFT JOIN locations site ON site.id = cp.site_id
     WHERE cp.id = $1
     FOR UPDATE OF cp`,
    [premisesId]
  );
  if (found.rows.length === 0) throw notFound('customer_premises not found');
  const premises = found.rows[0];

  if (!premises.is_active) {
    throw conflict('That premises is a former client — reinstate it before attaching it to a job');
  }
  if (job.site_id && premises.site_id && Number(premises.site_id) !== Number(job.site_id)) {
    throw badRequest(
      `That premises is filed under ${premises.site_name}, not this job’s site. ` +
        'Pick a premises at the job’s site.'
    );
  }

  const siteId = job.site_id ?? premises.site_id;
  if (!premises.site_id && siteId) {
    await client.query('UPDATE customer_premises SET site_id = $1 WHERE id = $2', [
      siteId,
      premisesId,
    ]);
  }

  await client.query(
    'UPDATE work_orders SET customer_premises_id = $1, site_id = $2 WHERE id = $3',
    [premisesId, siteId, job.id]
  );
}

module.exports = { attachPremisesToJob };
