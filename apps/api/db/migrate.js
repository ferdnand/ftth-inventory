#!/usr/bin/env node
// Numbered SQL migration runner.
//
// Replaces the old `psql "$DATABASE_URL" -f db/schema.sql` script, which relied
// on POSIX variable expansion and did not work in PowerShell or cmd.exe.
//
//   node db/migrate.js              apply every pending migration
//   node db/migrate.js status       list what is applied and what is pending
//   node db/migrate.js baseline [n] record migrations up to version n (default 1)
//                                   as applied WITHOUT running them — for a
//                                   database built by piping the old schema.sql
//                                   through psql. Follow it with `migrate` to
//                                   apply everything after n.
//
// Each file runs inside its own transaction, so a failure leaves the database on
// the last successfully applied migration rather than half-way through one.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('../src/lib/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Any integer would do; it just has to be the same in every runner process.
const ADVISORY_LOCK_KEY = 20260904;

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`No migrations directory at ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(filename);
      if (!match) {
        throw new Error(
          `Migration filename must be <number>_<name>.sql, got: ${filename}`
        );
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        filename,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client) {
  const result = await client.query(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
  );
  return new Map(result.rows.map((r) => [r.version, r]));
}

// An applied migration is immutable. If the file on disk no longer hashes to
// what was recorded, the database and the repo have silently diverged — fail
// loudly rather than letting the next migration build on a wrong assumption.
function assertUnchanged(migration, applied) {
  if (applied.checksum !== migration.checksum) {
    throw new Error(
      `Migration ${migration.filename} was already applied on ${applied.applied_at.toISOString()} ` +
        'but its contents have changed since. Applied migrations are immutable — ' +
        'revert the edit and add a new numbered migration instead.'
    );
  }
}

async function up() {
  const client = await db.pool.connect();
  try {
    // Serialize concurrent runners (two terminals, a test run alongside a dev
    // server). The lock is released when the session ends.
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const migrations = readMigrations();
    const applied = await appliedMigrations(client);
    let ran = 0;

    for (const migration of migrations) {
      const already = applied.get(migration.version);
      if (already) {
        assertUnchanged(migration, already);
        continue;
      }

      process.stdout.write(`Applying ${migration.filename} ... `);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
        console.log('ok');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }

    console.log(
      ran === 0
        ? `Database is up to date (${migrations.length} migration(s) applied).`
        : `Applied ${ran} migration(s).`
    );
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function status() {
  const client = await db.pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = readMigrations();
    const applied = await appliedMigrations(client);

    for (const migration of migrations) {
      const already = applied.get(migration.version);
      const mark = already ? 'applied ' : 'PENDING ';
      const when = already ? already.applied_at.toISOString() : '';
      console.log(`${mark} ${migration.filename} ${when}`);
    }

    const pending = migrations.filter((m) => !applied.has(m.version)).length;
    console.log(`\n${migrations.length} migration(s), ${pending} pending.`);
    return pending;
  } finally {
    client.release();
  }
}

// For a database created by the pre-migration-runner workflow: record the
// migrations it already contains as applied, without executing them. Running
// `up` against such a database would fail on `CREATE TYPE ... already exists`.
//
// Defaults to version 1 only — the old schema.sql is now 001_init.sql, so that
// is exactly what such a database has. Everything after it is then applied
// normally by `up`.
async function baseline(throughVersion) {
  const target = Number(throughVersion ?? 1);
  if (!Number.isInteger(target) || target < 1) {
    throw new Error('baseline takes a positive migration version, e.g. `baseline 1`');
  }

  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const migrations = readMigrations().filter((m) => m.version <= target);
    if (migrations.length === 0) {
      throw new Error(`No migrations at or below version ${target}`);
    }

    await client.query('BEGIN');
    try {
      for (const migration of migrations) {
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)
           ON CONFLICT (version) DO NOTHING`,
          [migration.version, migration.name, migration.checksum]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log(
      `Baselined ${migrations.length} migration(s) up to version ${target} as ` +
        'already applied. No SQL was executed.'
    );
    console.log('Now run `npm run migrate` to apply everything after that.');
    console.log(
      'If the database was NOT already at that schema, drop it and run ' +
        '`npm run migrate` on an empty database instead.'
    );
    return migrations.length;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

const COMMANDS = { up, status, baseline };

async function main() {
  const command = process.argv[2] || 'up';
  const run = COMMANDS[command];
  if (!run) {
    console.error(`Unknown command '${command}'. Expected one of: up, status, baseline`);
    process.exit(1);
  }

  try {
    await run(process.argv[3]);
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { up, status, baseline, readMigrations, ensureMigrationsTable };
