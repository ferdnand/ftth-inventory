// GET /api/stock returns a flat list of item_instances. The mockup shows
// per-model counts ("4 units in van"), and both views are needed: the count to
// know what is being carried, the individual serials to pick one to install.
//
// Grouping happens here rather than server-side because the flat response
// already carries everything both views need in ONE request — and on a phone
// that round trip is the expensive part.
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
        reorder_threshold: row.reorder_threshold,
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
      // A van also holds faulty and returned units awaiting a run back to the
      // warehouse. Badging those "Ready to install" would be a lie, so they are
      // split out rather than counted as stock.
      installable: group.units.filter((u) => u.status === 'in_stock'),
      toReturn: group.units.filter((u) => u.status === 'faulty' || u.status === 'returned'),
      other: group.units.filter(
        (u) => !['in_stock', 'faulty', 'returned'].includes(u.status)
      ),
    }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name)
    );
}

// /premises/:id/history returns one row per installation, each carrying both
// installed_at and a nullable removed_at. The mockup's timeline shows separate
// "Installed" and "Removed" entries, so fan each row into up to two events.
export function toTimelineEvents(timeline) {
  const events = [];

  for (const row of timeline) {
    events.push({
      kind: 'installed',
      at: row.installed_at,
      serial: row.serial_number,
      mac: row.mac_address,
      item: row.item_name,
      model: row.model,
      by: row.installed_by_name,
      // Labour belongs to the visit that installed the unit, so it rides on the
      // 'installed' event only — a removal undoes hardware, not work done.
      services: row.services ?? [],
      installationId: row.id,
    });

    if (row.removed_at) {
      events.push({
        kind: 'removed',
        at: row.removed_at,
        serial: row.serial_number,
        mac: row.mac_address,
        item: row.item_name,
        model: row.model,
        by: row.removed_by_name,
        reason: row.removal_reason,
        installationId: row.id,
      });
    }
  }

  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}
