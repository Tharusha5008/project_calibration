// Connectivity only: this command never initializes or seeds the database.
const db = require('./db');
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('missing configuration');
  await db.query('SELECT 1');
  console.log('PostgreSQL connection verified.');
})().catch(() => {
  console.error('Connection failed. Check DATABASE_URL, password encoding, network and TLS certificate configuration.');
  process.exitCode = 1;
}).finally(()=>db.close());
