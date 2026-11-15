// Populates demo data by driving the real API (so every state is consistent).
// Usage: start the API (npm start), then:  npm run seed:demo
const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`;

async function api(method, url, token, body) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${j.message || ''}`);
  return j;
}
const login = async (e, p) => (await api('POST', '/auth/login', null, { email: e, password: p })).token;

(async () => {
  const [admin, tech, tech2, user] = await Promise.all([login('admin@lab.test', 'Admin@123'), login('tech@lab.test', 'Tech@123'), login('tech2@lab.test', 'Tech@123'), login('user@lab.test', 'User@123')]);
  const { equipment } = await api('GET', '/equipment', user);
  const eq = (k) => equipment.find((e) => e.key === k);
  const techId = (await api('GET', '/auth/me', tech)).user.id;
  const tech2Id = (await api('GET', '/auth/me', tech2)).user.id;

  const check = async (key, pt, offsetRatio, serial, ctx = {}) => {
    const e = eq(key), p = e.points[pt];
    const measured = +(p.value + offsetRatio * p.mpe).toFixed(e.decimals + 2);
    return (await api('POST', '/checks', user, { equipmentTypeId: e.id, pointIndex: pt, measuredValue: measured, serialNo: serial, ...ctx })).check;
  };
  const readingsFor = (key, offFound, offLeft) => eq(key).points.map((p, i) => ({ index: i,
    as_found: +(p.value + offFound[i] * p.mpe).toFixed(4), as_left: offLeft ? +(p.value + offLeft[i] * p.mpe).toFixed(4) : undefined }));

  // A spread of self-checks
  await check('thermometer', 2, 0.3, 'TH-1001');
  await check('micrometer', 1, 0.55, 'MC-2204', { ageMonths: 14, daysSinceCal: 120 });
  await check('digital_scale', 3, 0.9, 'DS-0042', { ageMonths: 48, daysSinceCal: 400, usageHours: 1800 });
  await check('multimeter', 2, -0.4, 'MM-7781');

  // Token 1 - completed & closed (courier both ways), certificate PASS->ADJUSTED
  let c = await check('pressure_gauge', 2, 1.8, 'PG-3310', { ageMonths: 72, daysSinceCal: 640, usageHours: 2600, previousResult: 'adjusted' });
  let r = (await api('POST', '/requests', user, { checkId: c.id })).request;
  await api('POST', `/requests/${r.id}/handover`, user, { method: 'courier', courierName: 'DHL Express', trackingNo: 'DHL778800' });
  for (const [stage, loc] of [['In transit', 'Colombo hub'], ['Out for delivery', 'Lab district'], ['Delivered', 'Lab reception']]) await api('POST', `/requests/${r.id}/shipment`, user, { direction: 'inbound', stage, location: loc });
  await api('POST', `/requests/${r.id}/accept`, admin, { technicianId: techId, note: 'Package intact.' });
  await api('POST', `/requests/${r.id}/start`, tech);
  await api('POST', `/requests/${r.id}/update`, tech, { note: 'Needle linkage cleaned; zero adjusted.' });
  r = (await api('POST', `/requests/${r.id}/issue-certificate`, tech, { readings: readingsFor('pressure_gauge', [0.1, 0.9, 1.8, 0.7, 1.1], [0.05, 0.1, 0.2, 0.1, 0.15]), temperature: 22, humidity: 47, remarks: 'Linearity adjusted at 5 bar.' })).request;
  await api('POST', `/certificates/${r.certificate_id}/approve`, admin);
  await api('POST', `/requests/${r.id}/return`, admin, { method: 'courier', courierName: 'FedEx', trackingNo: 'FX204411' });
  await api('POST', `/requests/${r.id}/shipment`, admin, { direction: 'return', stage: 'In transit', location: 'Sorting centre' });
  await api('POST', `/requests/${r.id}/confirm-received`, user);

  // Token 2 - certificate waiting for admin approval
  c = await check('vernier_caliper', 1, 1.4, 'VC-5521');
  r = (await api('POST', '/requests', user, { checkId: c.id })).request;
  await api('POST', `/requests/${r.id}/handover`, user, { method: 'physical' });
  await api('POST', `/requests/${r.id}/accept`, admin, { technicianId: tech2Id });
  await api('POST', `/requests/${r.id}/start`, tech2);
  await api('POST', `/requests/${r.id}/issue-certificate`, tech2, { readings: readingsFor('vernier_caliper', [0.2, 1.4, 0.3, 0.6, 0.4], [0.1, 0.2, 0.1, 0.2, 0.1]), temperature: 21.8, humidity: 50 });

  // Token 3 - in calibration, token 4 - handed over by courier (in transit), token 5 - just booked
  c = await check('torque_wrench', 3, 2.2, 'TW-1180');
  r = (await api('POST', '/requests', user, { checkId: c.id })).request;
  await api('POST', `/requests/${r.id}/handover`, user, { method: 'physical' });
  await api('POST', `/requests/${r.id}/accept`, admin, { technicianId: techId });
  await api('POST', `/requests/${r.id}/start`, tech);

  c = await check('ph_meter', 1, 1.3, 'PH-8890', { ageMonths: 30, daysSinceCal: 300 });
  r = (await api('POST', '/requests', user, { checkId: c.id })).request;
  await api('POST', `/requests/${r.id}/handover`, user, { method: 'courier', courierName: 'Pronto Lanka', trackingNo: 'PL5530012' });
  await api('POST', `/requests/${r.id}/shipment`, user, { direction: 'inbound', stage: 'In transit', location: 'Kandy' });

  c = await check('strain_gauge', 2, 0.92, 'SG-0007', { ageMonths: 40, daysSinceCal: 500 });
  await api('POST', '/requests', user, { checkId: c.id });

  const t = (await api('GET', '/requests', admin)).requests;
  console.log(`Demo data ready: ${t.length} tokens. Sign in as admin@lab.test / tech@lab.test / user@lab.test`);
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
