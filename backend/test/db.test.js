const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bind, createDatabase, poolOptions } = require('../src/db');
test('binds values separately, including repeated named filters and literal question marks', () => {
  assert.deepEqual(bind("SELECT '?' AS literal, x FROM t WHERE x=? OR y=?",["' OR 1=1 --",null]),{text:"SELECT '?' AS literal, x FROM t WHERE x=$1 OR y=$2",values:["' OR 1=1 --",null]});
  assert.deepEqual(bind('SELECT * FROM t WHERE x=@id OR y=@id',[{id:4}]),{text:'SELECT * FROM t WHERE x=$1 OR y=$1',values:[4]});
  assert.throws(()=>bind('SELECT ? ',[]),/Missing/);
  assert.throws(()=>bind('SELECT 1',[4]),/Unexpected/);
});
test('remote TLS verification cannot be disabled by URL SSL parameters', () => {
  const config=poolOptions({DATABASE_URL:'postgresql://example:placeholder@db.example.test/postgres?sslmode=disable&ssl=false&uselibpqcompat=true'});
  assert.equal(config.ssl.rejectUnauthorized,true);
  for(const key of ['sslmode','ssl','uselibpqcompat']) assert.equal(new URL(config.connectionString).searchParams.has(key),false);
  assert.throws(()=>poolOptions({DATABASE_URL:'postgresql://example:placeholder@db.example.test/postgres',PGSSL:'disable'}),/only allowed/);
});
test('transactions use one client, nest, roll back failures and always release',async()=> {
  const calls=[];
  const client={query:async(sql)=> {calls.push(sql);return {rows:[],rowCount:0};},release:()=>calls.push('release')};
  const db=createDatabase({connect:async()=>client,query:async()=> {throw new Error('pool query inside transaction');}});
  await db.transaction(async()=> {await db.query('first');await db.transaction(()=>db.query('nested'));});
  assert.deepEqual(calls,['BEGIN','first','nested','COMMIT','release']);
  calls.length=0;
  await assert.rejects(db.transaction(async()=> {await db.query('write');throw new Error('failure');}),/failure/);
  assert.deepEqual(calls,['BEGIN','write','ROLLBACK','release']);
  calls.length=0;
  const query=client.query;
  client.query=async(sql)=> {if(sql==='COMMIT'){calls.push(sql);throw new Error('commit failure');}return query(sql);};
  await assert.rejects(db.transaction(()=>db.query('write')),/commit failure/);
  assert.deepEqual(calls,['BEGIN','write','COMMIT','ROLLBACK','release']);
});
test('write responses are withheld when commit fails',async()=> {
  const db=require('../src/db');
  const {wrap}=require('../src/lib/util');
  const transaction=db.transaction;
  let sent=false, failure;
  const response={json:()=> {sent=true;}};
  try {
    db.transaction=async(fn)=> {await fn();throw new Error('commit failed');};
    await wrap(async(req,res)=>res.json({ok:true}))({method:'POST',baseUrl:'/api/auth'},response,error=> {failure=error;});
    assert.equal(sent,false);
    assert.match(failure.message,/commit failed/);
  } finally { db.transaction=transaction; }
});
test('SQLite exporter opens a consistent read-only snapshot and dry run never connects',()=> {
  const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), crypto=require('node:crypto');
  const {spawnSync}=require('node:child_process');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cal-export-'));
  const file=path.join(folder,'source.db');
  const python=process.env.PYTHON || 'python';
  const script=`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nfor t in ['users','equipment_types','checks','requests','request_events','certificates','messages']: c.execute('CREATE TABLE '+t+' (id INTEGER PRIMARY KEY)')\nc.execute('INSERT INTO users(id) VALUES (42)')\nc.commit()\nc.close()`;
  try {
    const created=spawnSync(python,['-c',script,file],{encoding:'utf8'});
    assert.equal(created.status,0,created.stderr);
    const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before=hash();
    const exported=spawnSync(python,[path.join(__dirname,'../scripts/sqlite-export.py'),file],{encoding:'utf8'});
    assert.equal(exported.status,0,exported.stderr);
    assert.deepEqual(JSON.parse(exported.stdout).users,[{id:42}]);
    const dry=spawnSync(process.execPath,[path.join(__dirname,'../scripts/import-sqlite.js'),file],{encoding:'utf8',env:{...process.env,DATABASE_URL:'postgresql://example:placeholder@127.0.0.1:1/unreachable'}});
    assert.equal(dry.status,0,dry.stderr);
    assert.match(dry.stdout,/Dry run: no database connection/);
    assert.equal(hash(),before);
  } finally { fs.unlinkSync(file); fs.rmdirSync(folder); }
});
