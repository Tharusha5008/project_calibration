require('dotenv').config();
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

// Keep the existing JSON API: numeric counts and ISO date strings, including PDF input.
types.setTypeParser(20, value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('Database integer exceeds safe JSON range');
  return n;
});
types.setTypeParser(1082, value => value);
types.setTypeParser(1184, value => new Date(value).toISOString());

function poolOptions(env = process.env) {
  const options = { options: '-c timezone=UTC', max: Number(env.PGPOOL_MAX || 5), connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 };
  if (env.DATABASE_URL) {
    let url;
    try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
    // Do not allow URL parameters to silently replace our TLS verification settings.
    for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) url.searchParams.delete(key);
    options.connectionString = url.toString();
    const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if (env.PGSSL === 'disable' && !local) throw new Error('PGSSL=disable is only allowed for a local database');
    options.ssl = env.PGSSL === 'disable' || local ? false : {
      rejectUnauthorized: true,
      ...(env.PGSSLROOTCERT ? { ca: fs.readFileSync(env.PGSSLROOTCERT, 'utf8') } : {})
    };
  }
  return options;
}

// Only SQL owned by this application enters here. Values always go separately to pg.
// Supports dynamic filter fragments without interpolating any request values into SQL.
function bind(sql, args) {
  const values = [], names = new Map();
  const named = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]);
  let index = 0;
  const text = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|@([a-zA-Z_]\w*)/g, (token, name) => {
    if (token[0] === "'" || token[0] === '"') return token;
    if (name) {
      if (!named || !Object.hasOwn(args[0], name)) throw new Error('Missing SQL parameter');
      if (!names.has(name)) { names.set(name, values.length + 1); values.push(args[0][name]); }
      return '$' + names.get(name);
    }
    if (named || index >= args.length) throw new Error('Missing SQL parameter');
    values.push(args[index++] ?? null);
    return '$' + values.length;
  });
  if (!named && index !== args.length) throw new Error('Unexpected SQL parameters');
  return { text, values };
}

function createDatabase(pool) {
  const context = new AsyncLocalStorage();
  const db = {
    pool,
    async query(text, values = []) { return (context.getStore() || pool).query(text, values); },
    async get(sql, ...args) { const q = bind(sql, args); return (await db.query(q.text, q.values)).rows[0]; },
    async all(sql, ...args) { const q = bind(sql, args); return (await db.query(q.text, q.values)).rows; },
    async run(sql, ...args) {
      const q = bind(sql, args);
      if (/^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) q.text += ' RETURNING id';
      const result = await db.query(q.text, q.values);
      return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    },
    async transaction(fn) {
      // Nested helpers participate in the outer unit of work; errors propagate to its rollback.
      if (context.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
        throw err;
      } finally { client.release(); }
    },
    async init({ seedCatalog = true, seedDemo = process.env.SEED_DEMO_USERS === 'true', bootstrap = true } = {}) {
      await db.transaction(async () => {
        await db.query('SELECT pg_advisory_xact_lock(8675309)');
        await db.query(fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8'));
        // Import initializes with both seed options disabled, preserving catalogue IDs.
        if (seedCatalog && !(await db.get('SELECT COUNT(*) c FROM equipment_types')).c) {
          const catalog = require('../../shared/equipment-catalog.json');
          for (const c of catalog) await db.run(`INSERT INTO equipment_types
            (key,name,unit,decimals,range_min,range_max,standard,reference_tool,read_label,steps,points,model3d)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, c.key,c.name,c.unit,c.decimals,c.range[0],c.range[1],c.standard,c.reference_tool,c.read_label,JSON.stringify(c.steps),JSON.stringify(c.points),c.model3d);
        }
        if (seedDemo && process.env.NODE_ENV === 'production') throw new Error('Demo accounts are disabled in production');
        if (!(await db.get('SELECT COUNT(*) c FROM users')).c) {
          if (seedDemo) {
            for (const [name,email,password,role] of [
              ['Lab Administrator','admin@lab.test','Admin@123','admin'],
              ['Tara Technician','tech@lab.test','Tech@123','technician'],
              ['Sam Technician','tech2@lab.test','Tech@123','technician'],
              ['Uma User','user@lab.test','User@123','user']
            ]) await db.run('INSERT INTO users(full_name,email,password_hash,role,organisation) VALUES (?,?,?,?,?)',name,email,await bcrypt.hash(password,10),role,'Calibration Lab');
          } else if (bootstrap && process.env.BOOTSTRAP_ADMIN_EMAIL) {
            const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
            if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must have at least 12 characters');
            await db.run('INSERT INTO users(full_name,email,password_hash,role) VALUES (?,?,?,?)', 'Lab Administrator',process.env.BOOTSTRAP_ADMIN_EMAIL.trim(),await bcrypt.hash(password,12),'admin');
          }
        }
      });
    },
    async close() { await pool.end(); }
  };
  return db;
}
const pool = new Pool(poolOptions());
pool.on('error', err => console.error('Idle database connection failed:', err.code || 'unknown'));
const db = createDatabase(pool);
const init = db.init;
db.init = async (...args) => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before initializing the database');
  return init(...args);
};
module.exports = Object.assign(db, { createDatabase, poolOptions, bind });
