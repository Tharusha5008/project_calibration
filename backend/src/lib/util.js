const crypto = require('crypto');
const db = require('../db');

const J = (s, fallback = null) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// Wraps async route handlers so a thrown error becomes a JSON error instead of crashing the process.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);

// Tracking token like CAL-7K3QX9 (no 0/O/1/I to avoid misreading)
async function newToken() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const t = 'CAL-' + Array.from(crypto.randomBytes(6)).map((b) => alphabet[b % alphabet.length]).join('');
    if (!(await db.get('SELECT 1 AS x FROM requests WHERE token=?', t))) return t;
  }
}

// Certificate numbers come from the highest existing number this year, so they never collide.
async function newCertNumber(runner = db) {
  const y = new Date().getFullYear();
  const row = await runner.get("SELECT COALESCE(MAX(CAST(SUBSTRING(number FROM '[0-9]+$') AS INTEGER)), 0) AS n FROM certificates WHERE number LIKE ?", `CERT-${y}-%`);
  return `CERT-${y}-${String(row.n + 1).padStart(5, '0')}`;
}

function equipmentRow(r) {
  if (!r) return r;
  return { ...r, steps: J(r.steps, []), points: J(r.points, []), active: !!r.active };
}

function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 1 || points.length > 12) throw bad('Provide 1-12 standard points');
  return points.map((p, i) => {
    const value = Number(p.value), mpe = Number(p.mpe);
    if (!Number.isFinite(value)) throw bad(`Point ${i + 1}: value must be a number`);
    if (!Number.isFinite(mpe) || mpe <= 0) throw bad(`Point ${i + 1}: MPE must be a number greater than 0`);
    return { value, mpe, label: p.label || String(value) };
  });
}

async function logEvent(requestId, kind, title, detail, actorId, direction = null, runner = db) {
  await runner.run('INSERT INTO request_events (request_id,kind,title,detail,actor_id,direction) VALUES (?,?,?,?,?,?)',
    requestId, kind, title, detail || null, actorId || null, direction);
}

// Verdict from an exact calculation. error_ratio is a FRACTION of MPE (1.0 == at the limit).
function verdictFor(ratio) {
  return ratio >= 1 ? 'out' : ratio >= 0.8 ? 'warning' : 'within';
}

module.exports = { J, round, wrap, HttpError, bad, notFound, forbidden, newToken, newCertNumber,
  equipmentRow, validatePoints, logEvent, verdictFor };
