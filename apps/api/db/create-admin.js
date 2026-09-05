#!/usr/bin/env node
// Creates (or promotes) an administrator.
//
//   node db/create-admin.js --email you@example.com --name "Your Name" --password '...'
//   ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... node db/create-admin.js
//
// This exists because of a bootstrap problem: POST /api/users needs a signed-in
// pm or admin, and a freshly migrated database has neither. It is also the
// recovery path if the last admin account is ever lost — the API refuses to
// demote or deactivate the last one, but it cannot help with a forgotten
// password.
//
// Run it on the machine that can reach the database, not over the API. Prefer
// the environment variables to the flags: an argument list shows up in shell
// history and in `ps`.
//
// Re-running it for an existing email promotes that user to admin, reactivates
// them, and resets their password if one was supplied. Nothing else about the
// row changes, so it is safe to use on a real account.
const bcrypt = require('bcryptjs');
const db = require('../src/lib/db');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--([a-z-]+)$/.exec(argv[i]);
    if (!match) continue;
    args[match[1]] = argv[i + 1];
    i += 1;
  }
  return args;
}

function usage(message) {
  console.error(`\n${message}\n`);
  console.error('Usage:');
  console.error(
    '  node db/create-admin.js --email you@example.com --name "Your Name" --password <password>'
  );
  console.error('  ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... node db/create-admin.js\n');
  process.exit(1);
}

async function createAdmin({ name, email, password }) {
  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;

  // One statement, so a concurrent run cannot insert a second row for the same
  // address between the check and the write. uq_users_email_lower (migration
  // 002) is case-insensitive, which is why the conflict target is lower(email)
  // rather than the email column.
  const result = await db.query(
    `INSERT INTO users (name, email, role, password_hash, is_active)
     VALUES ($1, lower($2), 'admin', $3, TRUE)
     ON CONFLICT (lower(email)) DO UPDATE
       SET role = 'admin',
           is_active = TRUE,
           password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash)
     RETURNING id, name, email, role, is_active,
               (xmax = 0) AS created`,
    [name, email, passwordHash]
  );

  return result.rows[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = (args.email || process.env.ADMIN_EMAIL || '').trim();
  const name = (args.name || process.env.ADMIN_NAME || '').trim();
  const password = args.password || process.env.ADMIN_PASSWORD || '';

  if (!email || !email.includes('@')) usage('An --email (a valid address) is required.');
  if (!name) usage('A --name is required.');

  const existing = await db.query('SELECT id, password_hash FROM users WHERE lower(email) = lower($1)', [
    email,
  ]);
  const isNew = existing.rows.length === 0;

  // Login rejects any user whose password_hash IS NULL, so a new admin without
  // a password would be an account nobody can sign in to.
  if (isNew && !password) usage('A --password is required when creating a new admin.');
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    usage(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const user = await createAdmin({ name, email, password });

  console.log(
    user.created
      ? `Created admin #${user.id}: ${user.name} <${user.email}>`
      : `Promoted #${user.id} to admin: ${user.name} <${user.email}>` +
          (password ? ' (password reset)' : ' (password unchanged)')
  );
  console.log('Sign in at the dashboard with that address.');
}

main()
  .catch((err) => {
    console.error('\nFailed to create the admin:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
