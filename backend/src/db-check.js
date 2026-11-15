// Quick connection test:  npm run db:check
const db = require('./db');
(async () => {
  try {
    const v = await db.get('SELECT version() AS v, current_database() AS d');
    console.log('Connected to database "%s"\n%s', v.d, v.v);
    await db.init();
    const t = await db.get('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM equipment_types) AS equipment');
    console.log('Tables ready. users: %d, equipment types: %d', t.users, t.equipment);
    await db.pool.end();
  } catch (e) {
    console.error('\nConnection failed:', e.message);
    if (/ENOTFOUND|ETIMEDOUT|ENETUNREACH/.test(e.message + e.code)) console.error('Tip: use the "Session pooler" URI from Supabase (the direct connection is IPv6-only on many networks).');
    if (/password authentication failed/i.test(e.message)) console.error('Tip: wrong database password, or it has special characters that must be URL-encoded (@ -> %40, # -> %23).');
    if (/Tenant or user not found/i.test(e.message)) console.error('Tip: copy the pooler URI exactly - the user must look like postgres.<project-ref>.');
    process.exit(1);
  }
})();
