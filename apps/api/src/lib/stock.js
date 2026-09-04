// Bulk stock movement — the single implementation of the non-negative rule.
//
// Every path that changes stock_levels goes through here: generic transactions,
// restock fulfilment, and the tests. If the rule lived in more than one place,
// one of them would eventually drift.
//
// All functions take an already-checked-out client inside an open transaction.
// They never BEGIN, COMMIT or release — the caller owns the transaction.
const { conflict, notFound } = require('./errors');

// Takes a row lock before reading, so two concurrent decrements of the same
// (item, location) serialize instead of both reading the same balance and both
// deciding there is enough. Without FOR UPDATE the check is a race.
async function decrement(client, { itemId, locationId, quantity }) {
  const current = await client.query(
    `SELECT quantity FROM stock_levels
     WHERE item_id = $1 AND location_id = $2
     FOR UPDATE`,
    [itemId, locationId]
  );

  const onHand = current.rows.length > 0 ? Number(current.rows[0].quantity) : 0;
  if (onHand < quantity) {
    throw conflict(
      `Not enough stock at that location: ${onHand} on hand, ${quantity} requested`
    );
  }

  await client.query(
    `UPDATE stock_levels SET quantity = quantity - $1, updated_at = now()
     WHERE item_id = $2 AND location_id = $3`,
    [quantity, itemId, locationId]
  );

  return onHand - quantity;
}

// Creates the destination row on first use, which is why a transfer to a
// location that has never held this item still works.
async function increment(client, { itemId, locationId, quantity }) {
  const result = await client.query(
    `INSERT INTO stock_levels (item_id, location_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_id, location_id)
     DO UPDATE SET quantity = stock_levels.quantity + $3, updated_at = now()
     RETURNING quantity`,
    [itemId, locationId, quantity]
  );
  return Number(result.rows[0].quantity);
}

// One bulk movement: out of `fromLocationId` (if given) and into
// `toLocationId` (if given). A receive has no source; a consumption has no
// destination; a transfer has both.
//
// Locks in ascending location id order so two transfers in opposite directions
// between the same pair of locations cannot deadlock.
async function applyMove(client, { itemId, fromLocationId, toLocationId, quantity }) {
  if (!(quantity > 0)) {
    throw conflict('quantity must be greater than zero');
  }

  const result = {};

  if (fromLocationId && toLocationId && toLocationId < fromLocationId) {
    result.to = await increment(client, { itemId, locationId: toLocationId, quantity });
    result.from = await decrement(client, { itemId, locationId: fromLocationId, quantity });
    return result;
  }

  if (fromLocationId) {
    result.from = await decrement(client, { itemId, locationId: fromLocationId, quantity });
  }
  if (toLocationId) {
    result.to = await increment(client, { itemId, locationId: toLocationId, quantity });
  }
  return result;
}

// Loads a serialized unit under a row lock, so an install and a transfer cannot
// both act on the same instance. Callers assert on `status` and
// `current_location_id` from the returned row.
async function lockInstance(client, instanceId) {
  const result = await client.query(
    `SELECT ii.id, ii.item_id, ii.serial_number, ii.mac_address, ii.status,
            ii.current_location_id, ii.current_holder_id,
            i.tracking_type
     FROM item_instances ii
     JOIN items i ON i.id = ii.item_id
     WHERE ii.id = $1
     FOR UPDATE OF ii`,
    [instanceId]
  );
  if (result.rows.length === 0) {
    throw notFound('item_instance not found');
  }
  return result.rows[0];
}

// Guard shared by install and replace: you can only put a unit into service if
// it is genuinely available. Without this, installing an instance that is
// already `installed` elsewhere would silently orphan the other installation.
function assertInstallable(instance) {
  if (instance.status !== 'in_stock') {
    throw conflict(
      `Serial ${instance.serial_number} is '${instance.status}', not 'in_stock', so it cannot be installed`
    );
  }
  if (instance.tracking_type !== 'serialized') {
    throw conflict(`Serial ${instance.serial_number} is not a serialized item`);
  }
}

module.exports = { applyMove, decrement, increment, lockInstance, assertInstallable };
