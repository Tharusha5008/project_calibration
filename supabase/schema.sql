-- JSON snapshots remain TEXT and flags remain INTEGER to preserve the existing API and SQLite imports.
-- This schema creates missing objects only; it never drops, truncates or replaces application data.
-- CalibrateIQ schema for Supabase / PostgreSQL.
-- The backend runs this automatically on start (every statement is idempotent), so pasting it into
-- the Supabase SQL Editor is optional. Row Level Security is enabled with NO policies on purpose:
-- the app talks to Postgres directly with your DATABASE_URL, and this blocks anyone from reading
-- the tables through Supabase's public REST API with the anon key.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','technician','user')),
  organisation TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS equipment_types (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2,
  range_min DOUBLE PRECISION NOT NULL,
  range_max DOUBLE PRECISION NOT NULL,
  standard TEXT NOT NULL,
  reference_tool TEXT,
  read_label TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  points TEXT NOT NULL,
  model3d TEXT NOT NULL DEFAULT 'generic',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
  serial_no TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  nominal_value DOUBLE PRECISION NOT NULL,
  measured_value DOUBLE PRECISION NOT NULL,
  mpe DOUBLE PRECISION NOT NULL,
  error DOUBLE PRECISION NOT NULL,
  error_ratio DOUBLE PRECISION NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('within','warning','out')),
  suspicious INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '{}',
  ai TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
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
  calibration_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_tech ON requests(technician_id);

CREATE TABLE IF NOT EXISTS request_events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('status','shipment','note')),
  title TEXT NOT NULL,
  detail TEXT,
  direction TEXT,
  actor_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_request ON request_events(request_id);

CREATE TABLE IF NOT EXISTS certificates (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
  technician_id INTEGER NOT NULL REFERENCES users(id),
  result TEXT NOT NULL CHECK (result IN ('PASS','ADJUSTED','FAIL')),
  data TEXT NOT NULL,
  remarks TEXT,
  environment TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until DATE
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('feedback','issue','reply')),
  parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
