const db = require('./db');
db.init().then(()=>console.log('PostgreSQL schema and initialization complete.')).catch(()=> {
  console.error('Initialization failed; check configuration and database privileges. Credentials are not logged.');
  process.exitCode = 1;
}).finally(()=>db.close());
