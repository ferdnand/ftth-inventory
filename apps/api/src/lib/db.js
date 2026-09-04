const { Pool } = require('pg');
const env = require('./env');

function createPool(connectionString) {
  // Every session runs in one known timezone so date_trunc bucketing in the
  // report queries is deterministic regardless of the server's locale.
  //
  // Set as a startup option rather than a `SET TIME ZONE` in a 'connect'
  // listener: that listener's query races the caller's first query on the same
  // client, which pg warns about and which would leave the timezone unset on
  // exactly the queries that ran first.
  const pool = new Pool({
    connectionString,
    options: `-c timezone=${env.DB_TIMEZONE}`,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle pg client:', err);
  });

  return pool;
}

const pool = createPool(env.DATABASE_URL);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  createPool,
};
