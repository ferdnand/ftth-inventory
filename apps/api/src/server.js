// Process entrypoint. Everything that builds the app lives in src/app.js so the
// test suite can require it without opening a port.
const app = require('./app');
const env = require('./lib/env');

app.listen(env.PORT, () =>
  console.log(`FTTH inventory API listening on port ${env.PORT}`)
);
