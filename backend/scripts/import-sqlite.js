const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const db = require('../src/db');
const TABLES = ['users','equipment_types','checks','requests','request_events','certificates','messages'];
async function importRows(data, target = db) {
  if (JSON.stringify(Object.keys(data).sort()) !== JSON.stringify([...TABLES].sort())) throw new Error('Unexpected export tables');
  await target.init({ seedCatalog: false, seedDemo: false, bootstrap: false });
  return target.transaction(async () => {
    // An import never merges with or overwrites a populated application database.
    await target.query(`LOCK TABLE ${TABLES.join(',')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of TABLES) if ((await target.query(`SELECT COUNT(*) c FROM ${table}`)).rows[0].c != 0) throw new Error('Destination must be empty; no data was imported');
    const counts = {};
    for (const table of TABLES) {
      if (!Array.isArray(data[table])) throw new Error('Expected table rows');
      const columns = (await target.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [table])).rows.map(r => r.column_name);
      for (const row of data[table]) {
        const keys = Object.keys(row);
        if (!keys.length || keys.some(k => !columns.includes(k))) throw new Error('Unexpected export columns');
        await target.query(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`, keys.map(k=>row[k]));
      }
      const count = Number((await target.query(`SELECT COUNT(*) c FROM ${table}`)).rows[0].c);
      if (count !== data[table].length) throw new Error('Import count mismatch');
      // ALTER SEQUENCE is transactional; unlike setval it also rolls back on failure.
      const next = Number((await target.query(`SELECT COALESCE(MAX(id),0)+1 n FROM ${table}`)).rows[0].n);
      await target.query(`ALTER SEQUENCE ${table}_id_seq RESTART WITH ${next}`);
      counts[table] = count;
    }
    return counts;
  });
}
async function main() {
  const source = process.argv[2];
  if (!source || !fs.existsSync(source)) throw new Error('Usage: npm run db:import -- /absolute/path/to/backup.db [--apply]');
  const result = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname,'sqlite-export.py'),path.resolve(source)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('SQLite read-only export failed; check Python and the backup file');
  const data = JSON.parse(result.stdout);
  console.log('Source row counts:', Object.fromEntries(TABLES.map(t=>[t,data[t].length])));
  if (!process.argv.includes('--apply')) { console.log('Dry run: no database connection or writes. Add --apply to import into an EMPTY destination.'); return; }
  console.log('Imported row counts:', await importRows(data));
}
if (require.main === module) main().catch(() => { console.error('Import failed; transaction rolled back. Check the source backup and empty destination configuration.'); process.exitCode = 1; }).finally(()=>db.close());
module.exports = { importRows, TABLES };
