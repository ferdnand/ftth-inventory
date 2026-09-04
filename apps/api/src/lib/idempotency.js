// Replay protection for the two non-idempotent writes.
//
// A client generates a key per user-initiated submit (one tap of "Confirm") and
// resends the same key if the request has to be retried. A replay returns the
// row the first attempt created, with 200 instead of 201, so the caller can tell
// the difference without having to care.
//
// The pre-check below is the fast path; the partial unique index added in
// migration 003 is what actually makes it safe when two retries race.
const { optionalString } = require('./validate');

const IDEMPOTENCY_TABLES = {
  installations: 'installations',
  transactions: 'transactions',
};

function readKey(body) {
  return optionalString(body?.idempotency_key, 'idempotency_key', 200);
}

// Returns the previously written row, or null if this key is new.
async function findReplay(client, table, key) {
  if (!key) return null;
  const relation = IDEMPOTENCY_TABLES[table];
  if (!relation) throw new Error(`No idempotency support for table '${table}'`);

  const result = await client.query(
    `SELECT * FROM ${relation} WHERE idempotency_key = $1`,
    [key]
  );
  return result.rows[0] || null;
}

// A unique violation on the idempotency index means a concurrent retry won the
// race. That is a success, not an error — re-read and return its row.
function isIdempotencyConflict(err) {
  return (
    err.code === '23505' &&
    (err.constraint === 'uq_installations_idempotency_key' ||
      err.constraint === 'uq_transactions_idempotency_key')
  );
}

module.exports = { readKey, findReplay, isIdempotencyConflict };
