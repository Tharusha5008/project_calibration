require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'calibration.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','technician','user')),
  organisation TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Equipment catalogue: one row per instrument TYPE with its standard (reference) test points.
CREATE TABLE IF NOT EXISTS equipment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2,
  range_min REAL NOT NULL,
  range_max REAL NOT NULL,
  standard TEXT NOT NULL,
  reference_tool TEXT,
  read_label TEXT,
  steps TEXT NOT NULL DEFAULT '[]',     -- JSON array of guide steps
  points TEXT NOT NULL,                 -- JSON array of {value, mpe, label}
  model3d TEXT NOT NULL DEFAULT 'generic',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A self-check done by a user against one standard point.
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
  serial_no TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  nominal_value REAL NOT NULL,
  measured_value REAL NOT NULL,
  mpe REAL NOT NULL,
  error REAL NOT NULL,
  error_ratio REAL NOT NULL,            -- |error| / mpe as a FRACTION (1.0 == at the limit)
  verdict TEXT NOT NULL CHECK (verdict IN ('within','warning','out')),
  suspicious INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '{}',   -- JSON: age, days since cal, usage, temp, humidity, prev result (+ which were assumed)
  ai TEXT,                              -- JSON snapshot of the AI service answer (or null)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A calibration "token": the job ticket that follows an instrument through the lab.
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
  check_id INTEGER REFERENCES checks(id),
  serial_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  technician_id INTEGER REFERENCES users(id),
  handover_method TEXT CHECK (handover_method IN ('physical','courier')),
  courier_name TEXT,
  tracking_no TEXT,
  return_method TEXT CHECK (return_method IN ('pickup','courier')),
  return_courier TEXT,
  return_tracking_no TEXT,
  calibration_data TEXT,                -- JSON array of {value, mpe, as_found, as_left}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_tech ON requests(technician_id);

-- Timeline: status changes, shipment (courier) tracking updates and notes.
CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('status','shipment','note')),
  title TEXT NOT NULL,
  detail TEXT,
  direction TEXT,                       -- shipment only: inbound | return
  actor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_request ON request_events(request_id);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
  technician_id INTEGER NOT NULL REFERENCES users(id),
  result TEXT NOT NULL CHECK (result IN ('PASS','ADJUSTED','FAIL')),
  data TEXT NOT NULL,                   -- JSON snapshot of calibration points
  remarks TEXT,
  environment TEXT,                     -- JSON {temperature, humidity}
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT
);

-- Feedback (technician/user) and issues (user) with admin replies.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('feedback','issue','reply')),
  parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seedCatalog() {
  const count = db.prepare('SELECT COUNT(*) c FROM equipment_types').get().c;
  if (count > 0) return;
  const catalogPath = path.join(__dirname, '..', '..', 'shared', 'equipment-catalog.json');
  const local = path.join(__dirname, '..', 'data', 'equipment-catalog.json');
  const file = fs.existsSync(catalogPath) ? catalogPath : local;
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ins = db.prepare(`INSERT INTO equipment_types
    (key,name,unit,decimals,range_min,range_max,standard,reference_tool,read_label,steps,points,model3d)
    VALUES (@key,@name,@unit,@decimals,@rmin,@rmax,@standard,@ref,@read,@steps,@points,@model3d)`);
  db.transaction(() => {
    for (const c of catalog) {
      ins.run({ key: c.key, name: c.name, unit: c.unit, decimals: c.decimals, rmin: c.range[0], rmax: c.range[1],
        standard: c.standard, ref: c.reference_tool, read: c.read_label, steps: JSON.stringify(c.steps),
        points: JSON.stringify(c.points), model3d: c.model3d });
    }
  })();
  console.log(`Seeded ${catalog.length} equipment types`);
}

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO users (full_name,email,password_hash,role,organisation) VALUES (?,?,?,?,?)');
  const demo = [
    ['Lab Administrator', 'admin@lab.test', 'Admin@123', 'admin', 'Calibration Lab'],
    ['Tara Technician', 'tech@lab.test', 'Tech@123', 'technician', 'Calibration Lab'],
    ['Sam Technician', 'tech2@lab.test', 'Tech@123', 'technician', 'Calibration Lab'],
    ['Uma User', 'user@lab.test', 'User@123', 'user', 'Acme Manufacturing'],
  ];
  for (const [n, e, p, r, o] of demo) ins.run(n, e, bcrypt.hashSync(p, 10), r, o);
  console.log('Seeded demo accounts (change these passwords before real use)');
}

seedCatalog();
seedUsers();

module.exports = db;
