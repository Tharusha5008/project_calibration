require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// ---- Type parsing: keep the API shape identical to the old SQLite version ----------------------
types.setTypeParser(20, (v) => parseInt(v, 10));                       // COUNT(*) etc. -> number
types.setTypeParser(1700, (v) => parseFloat(v));                       // numeric -> number
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());     // timestamp   -> ISO string
types.setTypeParser(1184, (v) => new Date(v).toISOString());           // timestamptz -> ISO string
types.setTypeParser(1082, (v) => v);                                   // date -> 'YYYY-MM-DD'

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nFATAL: DATABASE_URL is not set.\n' +
    'Copy backend/.env.example to backend/.env and paste your Supabase connection string\n' +
    '(Supabase dashboard -> Connect -> "Session pooler" URI).\n');
  process.exit(1);
}
// Optional isolated schema (used by the automated tests; not needed for Supabase).
const SCHEMA = process.env.DB_SCHEMA && /^[a-z0-9_]+$/i.test(process.env.DB_SCHEMA) ? process.env.DB_SCHEMA : null;
if (/\[YOUR-PASSWORD\]|xxxxxxxxxxxx|your-region/i.test(url)) {
  console.error('\nFATAL: DATABASE_URL in backend/.env is still the placeholder.\n' +
    'Open your Supabase project -> Connect -> "Session pooler", copy the URI, put your real password in it, and save backend/.env.\n');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const pool = new Pool({
  connectionString: url,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DB_SSL === 'false' || local ? false : { rejectUnauthorized: false }, // Supabase requires TLS
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA},public` } : {}),
});
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

// '?' placeholders -> $1, $2 ... (keeps the SQL readable)
const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function api(exec) {
  return {
    all: async (sql, ...p) => (await exec(conv(sql), p)).rows,
    get: async (sql, ...p) => (await exec(conv(sql), p)).rows[0],
    run: async (sql, ...p) => ({ changes: (await exec(conv(sql), p)).rowCount }),
    insert: async (sql, ...p) => (await exec(conv(sql) + ' RETURNING id', p)).rows[0].id, // returns the new id
  };
}
const db = api((sql, p) => pool.query(sql, p));

// Run several statements atomically:  await db.tx(async (t) => { await t.run(...); ... })
db.tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(api((sql, p) => client.query(sql, p)));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
};
db.pool = pool;

async function seedCatalog() {
  if ((await db.get('SELECT COUNT(*) c FROM equipment_types')).c > 0) return;
  const shared = path.join(__dirname, '..', '..', 'shared', 'equipment-catalog.json');
  const file = fs.existsSync(shared) ? shared : path.join(__dirname, '..', 'data', 'equipment-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.tx(async (t) => {
    for (const c of catalog) {
      await t.run(`INSERT INTO equipment_types (key,name,unit,decimals,range_min,range_max,standard,reference_tool,read_label,steps,points,model3d)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, c.key, c.name, c.unit, c.decimals, c.range[0], c.range[1], c.standard,
        c.reference_tool, c.read_label, JSON.stringify(c.steps), JSON.stringify(c.points), c.model3d);
    }
  });
  console.log(`Seeded ${catalog.length} equipment types`);
}

async function seedUsers() {
  if ((await db.get('SELECT COUNT(*) c FROM users')).c > 0) return;
  const demo = [
    ['Lab Administrator', 'admin@lab.test', 'Admin@123', 'admin', 'Calibration Lab'],
    ['Tara Technician', 'tech@lab.test', 'Tech@123', 'technician', 'Calibration Lab'],
    ['Sam Technician', 'tech2@lab.test', 'Tech@123', 'technician', 'Calibration Lab'],
    ['Uma User', 'user@lab.test', 'User@123', 'user', 'Acme Manufacturing'],
  ];
  for (const [n, e, p, r, o] of demo) {
    await db.run('INSERT INTO users (full_name,email,password_hash,role,organisation) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', n, e, bcrypt.hashSync(p, 10), r, o);
  }
  console.log('Seeded demo accounts (change these passwords before real use)');
}

let initPromise;
// Creates the tables (idempotent) and seeds the catalogue + demo accounts on first run.
db.init = () => (initPromise ||= (async () => {
  if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'schema.sql'), 'utf8'));
  await seedCatalog();
  if (process.env.SEED_DEMO_USERS !== 'false') await seedUsers();
})());

module.exports = db;
