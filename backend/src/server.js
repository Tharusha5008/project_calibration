require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render/nginx: use the real client IP for rate limiting
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: false }));
app.use(express.json({ limit: '5mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('tiny'));

app.get('/api/health', async (req, res) => {
  let dbOk = true;
  try { await db.get('SELECT 1 AS ok'); } catch { dbOk = false; }
  const ai = await require('./lib/ai').status();
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, database: dbOk ? 'connected' : 'unreachable', ai: { reachable: !ai.unavailable, trained: !!ai.trained } });
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
  // PostgreSQL error codes -> friendly HTTP answers
  if (err.code === '22P02') return res.status(404).json({ message: 'Not found' });                       // invalid id format
  if (err.code === '23505') return res.status(409).json({ message: 'That record already exists' });      // unique violation
  if (err.code === '23503') return res.status(409).json({ message: 'This record is still in use by other data' }); // foreign key
  if (err.code === '23514') return res.status(400).json({ message: 'A value is not allowed' });           // check constraint
  console.error('Request failed:', err.code || 'unknown');
  res.status(500).json({ message: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  db.init().then(() => {
    const server = app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`));
    const stop = () => {
      server.close(() => db.close().then(()=>process.exit(0)));
      setTimeout(()=>process.exit(1), 10000).unref();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }).catch(async () => {
    console.error('Database initialization failed. Check DATABASE_URL, TLS, privileges and schema; credentials are not logged.');
    await db.close();
    process.exitCode = 1;
  });
}
module.exports = app;
