const { Pool, types } = require('pg');
const env = require('./env');

// A DATE is a calendar day, not an instant, and pg's default parser turns it
// into a JS Date at midnight UTC. Serialized to JSON in Kenya (UTC+3) that
// comes back out as the PREVIOUS day at 21:00Z, so a job done on the 10th
// reaches both clients as the 9th and lands in the wrong day's figures.
//
// Handing the string through untouched is what a calendar day actually is.
// This affects work_orders.performed_on and scheduled_date, and it is set here
// rather than per query because there is no column for which the shifted
// behaviour is the right one.
types.setTypeParser(types.builtins.DATE, (value) => value);

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
