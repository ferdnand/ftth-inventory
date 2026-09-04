// Loads apps/api/.env regardless of the cwd the process was started from.
// dotenv's default resolves against process.cwd(), which breaks when a script
// is invoked from the workspace root instead of from apps/api.
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and fill it in.'
  );
  process.exit(1);
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: Number(process.env.PORT) || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  JWT_TTL: process.env.JWT_TTL || '12h',
  DB_TIMEZONE: process.env.DB_TIMEZONE || 'UTC',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
