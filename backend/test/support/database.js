const { PGlite } = require('@electric-sql/pglite');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const { createDatabase, poolOptions } = require('../../src/db');
async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    // The only persistent DDL tests remove is this freshly generated, dedicated schema.
    const schema = 'cal_test_' + crypto.randomBytes(12).toString('hex');
    const config = poolOptions({ DATABASE_URL: process.env.TEST_DATABASE_URL, PGSSLROOTCERT: process.env.PGSSLROOTCERT });
    const admin = new Pool(config);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ ...config, options: `-c search_path=${schema},public -c timezone=UTC` });
    const db = createDatabase(pool);
    return { db, async cleanup() { await db.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
  }
  const engine = new PGlite();
  await engine.waitReady;
  let tail = Promise.resolve();
  const normalize = value => value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : value;
  async function query(text, values = []) {
    const result = values.length ? await engine.query(text, values) : (await engine.exec(text)).at(-1);
    return { rows: (result.rows || []).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,normalize(v)]))), rowCount: result.affectedRows ?? 0 };
  }
  const pool = {
    async connect() {
      const previous = tail;
      let release;
      tail = new Promise(resolve=> { release = resolve; });
      await previous;
      return { query, release };
    },
    async query(text, values) { const client = await pool.connect(); try { return await query(text,values); } finally { client.release(); } },
    async end() { await engine.close(); }
  };
  const db = createDatabase(pool);
  return { db, cleanup: ()=>db.close() };
}
module.exports = { testDatabase };
