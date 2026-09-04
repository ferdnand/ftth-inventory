// Response shaping.
//
// Anything that returns a user row goes through publicUser, so password_hash
// can never leak by someone writing `SELECT *` in a new route.

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    assigned_location_id: row.assigned_location_id ?? null,
    assigned_location_name: row.assigned_location_name ?? null,
    assigned_location_type: row.assigned_location_type ?? null,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

module.exports = { publicUser };
