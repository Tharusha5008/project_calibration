// End-to-end workflow test. Uses a throw-away SQLite file and an in-process server.
// The AI service is optional: tests assert the exact verdict works with or without it.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(os.tmpdir(), `cal-test-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
const app = require('../src/server');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}/api`; });
after(() => { server.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true }); });

async function api(method, url, token, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), type };
}
const login = async (email, password) => (await api('POST', '/auth/login', null, { email, password })).body.token;

test('full calibration lifecycle', async () => {
  const [admin, tech, user] = [await login('admin@lab.test', 'Admin@123'), await login('tech@lab.test', 'Tech@123'), await login('user@lab.test', 'User@123')];
  assert.ok(admin && tech && user);

  const eqs = (await api('GET', '/equipment', user)).body.equipment;
  assert.strictEqual(eqs.length, 10);
  const caliper = eqs.find((e) => e.key === 'vernier_caliper');

  // Reading wildly outside the instrument range is rejected (wrong unit / decimal) - never a "900%" result
  let r = await api('POST', '/checks', user, { equipmentTypeId: caliper.id, pointIndex: 2, measuredValue: 5000, serialNo: 'VC-001' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.message, /outside/);

  // Missing serial
  r = await api('POST', '/checks', user, { equipmentTypeId: caliper.id, pointIndex: 2, measuredValue: 50.0 });
  assert.strictEqual(r.status, 400);

  // Within tolerance: 50.01 vs 50.00 with MPE 0.02 => 50% of MPE (a FRACTION 0.5, shown as 50.0%)
  r = await api('POST', '/checks', user, { equipmentTypeId: caliper.id, pointIndex: 2, measuredValue: 50.01, serialNo: 'VC-001' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.check.verdict, 'within');
  assert.strictEqual(r.body.check.error_ratio, 0.5);
  assert.strictEqual(r.body.check.error_pct_of_tolerance, 50);
  const ok = await api('POST', '/requests', user, { checkId: r.body.check.id });
  assert.strictEqual(ok.status, 400);          // cannot book a token when within tolerance

  // Out of tolerance: 50.05 vs 50.00, MPE 0.02 => 250% of MPE (and bounded, not 900%)
  r = await api('POST', '/checks', user, { equipmentTypeId: caliper.id, pointIndex: 2, measuredValue: 50.05, serialNo: 'VC-001', ageMonths: 60, daysSinceCal: 500 });
  assert.strictEqual(r.body.check.verdict, 'out');
  assert.strictEqual(r.body.check.error_pct_of_tolerance, 250);
  const checkId = r.body.check.id;

  // Book token
  r = await api('POST', '/requests', user, { checkId });
  assert.strictEqual(r.status, 201);
  const id = r.body.request.id;
  assert.match(r.body.request.token, /^CAL-[A-Z0-9]{6}$/);
  assert.strictEqual((await api('POST', '/requests', user, { checkId })).status, 400); // duplicate

  // Role guards
  assert.strictEqual((await api('POST', `/requests/${id}/accept`, user, { technicianId: 2 })).status, 403);
  assert.strictEqual((await api('POST', `/requests/${id}/start`, tech)).status, 403);   // not assigned & wrong state

  // Handover by courier requires details
  assert.strictEqual((await api('POST', `/requests/${id}/handover`, user, { method: 'courier' })).status, 400);
  r = await api('POST', `/requests/${id}/handover`, user, { method: 'courier', courierName: 'DHL', trackingNo: 'DHL123456' });
  assert.strictEqual(r.body.request.status, 'handed_over');
  r = await api('POST', `/requests/${id}/shipment`, user, { direction: 'inbound', stage: 'In transit', location: 'Colombo hub' });
  assert.strictEqual(r.status, 200);

  // Admin accepts and assigns technician
  const techId = (await api('GET', '/auth/me', tech)).body.user.id;
  r = await api('POST', `/requests/${id}/accept`, admin, { technicianId: techId });
  assert.strictEqual(r.body.request.status, 'accepted');

  // Technician starts, saves a draft update
  r = await api('POST', `/requests/${id}/start`, tech);
  assert.strictEqual(r.body.request.status, 'in_calibration');
  r = await api('POST', `/requests/${id}/update`, tech, { note: 'Jaw faces cleaned, zero reset.' });
  assert.strictEqual(r.status, 200);

  // Cannot issue without all readings
  r = await api('POST', `/requests/${id}/issue-certificate`, tech, { readings: [{ index: 0, as_found: 10.0 }] });
  assert.strictEqual(r.status, 400);

  // Readings: as-found out of tolerance at 50, adjusted as-left all good => ADJUSTED (computed server-side)
  const pts = caliper.points;
  const readings = pts.map((p, i) => ({ index: i, as_found: i === 2 ? p.value + 0.05 : p.value + 0.005, as_left: p.value + 0.004 }));
  r = await api('POST', `/requests/${id}/issue-certificate`, tech, { readings, remarks: 'Zero offset corrected.', temperature: 21.5, humidity: 48 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.request.status, 'certificate_pending');
  assert.strictEqual(r.body.request.certificate_result, 'ADJUSTED');
  const certId = r.body.request.certificate_id;

  // Customer cannot see or download an unapproved certificate
  assert.strictEqual((await api('GET', `/certificates/${certId}/pdf`, user)).status, 404);

  // Admin rejects, tech reworks, admin approves
  assert.strictEqual((await api('POST', `/certificates/${certId}/reject`, admin, { reason: 'x' })).status, 400);
  assert.strictEqual((await api('POST', `/certificates/${certId}/reject`, admin, { reason: 'Add ambient humidity reading' })).status, 200);
  r = await api('GET', `/requests/${id}`, tech);
  assert.strictEqual(r.body.request.status, 'in_calibration');
  r = await api('POST', `/requests/${id}/issue-certificate`, tech, { readings, temperature: 21.5, humidity: 48 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await api('POST', `/certificates/${certId}/approve`, admin)).status, 200);

  // Customer downloads the PDF certificate
  r = await api('GET', `/certificates/${certId}/pdf`, user);
  assert.strictEqual(r.status, 200);
  assert.ok(r.type.includes('pdf'));
  assert.strictEqual(r.body.subarray(0, 5).toString(), '%PDF-');

  // Return by courier, customer confirms
  r = await api('POST', `/requests/${id}/return`, admin, { method: 'courier', courierName: 'FedEx', trackingNo: 'FX99' });
  assert.strictEqual(r.body.request.status, 'returning');
  assert.strictEqual((await api('POST', `/requests/${id}/shipment`, admin, { direction: 'return', stage: 'Out for delivery' })).status, 200);
  r = await api('POST', `/requests/${id}/confirm-received`, user);
  assert.strictEqual(r.body.request.status, 'closed');

  // Timeline has the whole story
  r = await api('GET', `/requests/${id}`, user);
  assert.ok(r.body.events.length >= 10);
  assert.ok(r.body.events.some((e) => e.kind === 'shipment'));

  // Feedback + issue + admin reply
  assert.strictEqual((await api('POST', '/messages', tech, { requestId: id, kind: 'feedback', body: 'Customer jaw was dirty on arrival.' })).status, 201);
  r = await api('POST', '/messages', user, { requestId: id, kind: 'issue', subject: 'Scratch on case', body: 'Case has a new scratch after return.' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await api('POST', `/messages/${r.body.message.id}/reply`, admin, { body: 'Sorry - we will review CCTV.' })).status, 201);

  // Reports: weekly + monthly PDFs for every role
  for (const [role, t] of [['admin', admin], ['tech', tech], ['user', user]]) {
    for (const period of ['weekly', 'monthly']) {
      const p = await api('GET', `/reports/pdf?period=${period}`, t);
      assert.strictEqual(p.status, 200, `${role} ${period}`);
      assert.strictEqual(p.body.subarray(0, 5).toString(), '%PDF-');
    }
  }
  const sum = (await api('GET', '/reports/summary?period=weekly', admin)).body;
  assert.ok(sum.kpis.checks >= 2 && sum.kpis.certificates === 1);
  // A customer's report must never include someone else's data
  const other = await api('POST', '/auth/register', null, { fullName: 'Other Person', email: 'other@x.test', password: 'Password1' });
  const otherSum = (await api('GET', '/reports/summary?period=monthly', other.body.token)).body;
  assert.strictEqual(otherSum.kpis.checks, 0);
  assert.strictEqual((await api('GET', `/requests/${id}`, other.body.token)).status, 403);
});

test('admin manages equipment and accounts', async () => {
  const admin = await login('admin@lab.test', 'Admin@123');
  const user = await login('user@lab.test', 'User@123');
  assert.strictEqual((await api('POST', '/equipment', user, {})).status, 403);

  let r = await api('POST', '/equipment', admin, { name: 'Dial Indicator', unit: 'mm', standard: 'ISO 463', points: [{ value: 1, mpe: 0.005 }, { value: 5, mpe: 0.008 }], rangeMin: 0, rangeMax: 10 });
  assert.strictEqual(r.status, 201);
  const newId = r.body.equipment.id;
  assert.strictEqual((await api('POST', '/equipment', admin, { name: 'Bad', unit: 'mm', points: [{ value: 1, mpe: 0 }] })).status, 400);
  assert.strictEqual((await api('POST', '/equipment', admin, { name: 'Out', unit: 'mm', rangeMin: 0, rangeMax: 2, points: [{ value: 5, mpe: 1 }] })).status, 400);

  // A custom type (not in the AI training data) still gets an exact verdict; AI says "unsupported" honestly
  r = await api('POST', '/checks', user, { equipmentTypeId: newId, pointIndex: 0, measuredValue: 1.003, serialNo: 'DI-1' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.check.verdict, 'within');
  assert.strictEqual(r.body.ai.supported, false);

  // Used equipment is retired, unused is deleted
  r = await api('DELETE', `/equipment/${newId}`, admin);
  assert.strictEqual(r.body.retired, true);
  r = await api('POST', '/equipment', admin, { name: 'Temp Gauge', unit: 'mm', points: [{ value: 1, mpe: 0.1 }], rangeMin: 0, rangeMax: 2 });
  r = await api('DELETE', `/equipment/${r.body.equipment.id}`, admin);
  assert.strictEqual(r.body.retired, false);

  // Accounts
  r = await api('POST', '/users', admin, { fullName: 'New Tech', email: 'nt@lab.test', password: 'Passw0rd!', role: 'technician' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await api('PATCH', `/users/${r.body.user.id}`, admin, { isActive: false })).body.user.is_active, 0);
  assert.strictEqual((await api('POST', '/auth/login', null, { email: 'nt@lab.test', password: 'Passw0rd!' })).status, 403);
  assert.strictEqual((await api('DELETE', `/users/${r.body.user.id}`, admin)).status, 200);
  assert.strictEqual((await api('GET', '/users', user)).status, 403);
});
