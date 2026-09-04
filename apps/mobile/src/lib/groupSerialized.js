import { num } from './format';

// GET /api/stock returns a flat list of item_instances. The mockup shows
// per-model counts ("4 units in van"), and the tech needs both: the count to
// know what they are carrying, the serials to pick one to install.
//
// Grouped client-side rather than server-side because the flat response already
// carries everything both views need in ONE request — and on a phone in the
// field that round trip is the expensive part.
export function groupSerialized(rows) {
  const byItem = new Map();

  for (const row of rows) {
    let group = byItem.get(row.item_id);
    if (!group) {
      group = {
        item_id: row.item_id,
        item_name: row.item_name,
        category: row.category,
        manufacturer: row.manufacturer,
        model: row.model,
        reorder_threshold: num(row.reorder_threshold),
        units: [],
      };
      byItem.set(row.item_id, group);
    }
    group.units.push({
      id: row.id,
      serial_number: row.serial_number,
      mac_address: row.mac_address,
      status: row.status,
    });
  }

  return [...byItem.values()]
    .map((group) => ({
      ...group,
      // A van also holds faulty and returned units awaiting a run to the
      // warehouse. Badging those "Ready to install" would be a lie, so they are
      // split out — the mockup has no section for them, and it needs one.
      installable: group.units.filter((u) => u.status === 'in_stock'),
      toReturn: group.units.filter((u) => u.status === 'faulty' || u.status === 'returned'),
      other: group.units.filter((u) => !['in_stock', 'faulty', 'returned'].includes(u.status)),
    }))
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name)
    );
}

// A model is low when the units a tech could actually install fall to or below
// the threshold. Counting faulty units as stock would hide a van that has
// nothing usable left.
export const isModelLow = (group) =>
  group.reorder_threshold !== null && group.installable.length <= group.reorder_threshold;

// /premises/:id/history returns one row per installation carrying both
// installed_at and a nullable removed_at. Mockup screen 03 shows separate
// "Installed" and "Removed" entries, so fan each row into up to two events.
export function toTimelineEvents(timeline) {
  const events = [];

  for (const row of timeline) {
    events.push({
      key: `${row.id}-installed`,
      kind: 'installed',
      at: row.installed_at,
      serial: row.serial_number,
      mac: row.mac_address,
      item: row.item_name,
      by: row.installed_by_name,
    });

    if (row.removed_at) {
      events.push({
        key: `${row.id}-removed`,
        kind: 'removed',
        at: row.removed_at,
        serial: row.serial_number,
        mac: row.mac_address,
        item: row.item_name,
        by: row.removed_by_name,
        reason: row.removal_reason,
      });
    }
  }

  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}
