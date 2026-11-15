require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('./db');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: false }));
app.use(express.json({ limit: '5mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('tiny'));

app.get('/api/health', async (req, res) => {
  const ai = await require('./lib/ai').status();
  res.json({ ok: true, ai: { reachable: !ai.unavailable, trained: !!ai.trained } });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/checks', require('./routes/checks'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api', require('./routes/stats'));
app.use('/api', (req, res) => res.status(404).json({ message: 'Unknown API endpoint' }));

// Serve the built frontend (npm run build in /frontend) from the same origin
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Central error handler: nothing here can crash the process (the old backend crashed on unhandled rejections).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`));
module.exports = app;
