const express = require('express');
const cors = require('cors');

const env = require('./lib/env');
const { errorHandler } = require('./lib/errors');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const stockRoutes = require('./routes/stock');
const premisesRoutes = require('./routes/premises');
const installationsRoutes = require('./routes/installations');
const transactionsRoutes = require('./routes/transactions');
const catalogRoutes = require('./routes/catalog');
const usersRoutes = require('./routes/users');
const itemInstancesRoutes = require('./routes/itemInstances');
const restockRequestsRoutes = require('./routes/restockRequests');
const reportsRoutes = require('./routes/reports');

const app = express();

// An empty CORS_ORIGINS is permissive, which is what you want against a Vite
// dev server on a random port. Set the allowlist before deploying.
app.use(
  cors(env.CORS_ORIGINS.length > 0 ? { origin: env.CORS_ORIGINS } : undefined)
);
app.use(express.json({ limit: '1mb' }));

// --- Unauthenticated ---
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);

// --- Everything below this line requires a valid token ---
// This mount is load-bearing: it is what makes a newly added router fail closed.
// A router mounted ABOVE it is silently public. Add new routers below.
app.use('/api', requireAuth);

app.use('/api/stock', stockRoutes);
app.use('/api/premises', premisesRoutes);
app.use('/api/installations', installationsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/item-instances', itemInstancesRoutes);
app.use('/api/restock-requests', restockRequestsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api', catalogRoutes); // /api/items, /api/locations, /api/work-orders

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
