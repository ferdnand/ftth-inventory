require('dotenv').config();
const express = require('express');
const cors = require('cors');

const stockRoutes = require('./routes/stock');
const premisesRoutes = require('./routes/premises');
const installationsRoutes = require('./routes/installations');
const transactionsRoutes = require('./routes/transactions');
const catalogRoutes = require('./routes/catalog');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/stock', stockRoutes);
app.use('/api/premises', premisesRoutes);
app.use('/api/installations', installationsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api', catalogRoutes); // /api/items, /api/locations, /api/work-orders

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FTTH inventory API listening on port ${PORT}`));

module.exports = app;
