const PDFDocument = require('pdfkit');

const INK = '#0F2A3D', TEAL = '#0E7C7B', MUTED = '#5B6B78', LINE = '#D5DDE3', PASS = '#2E7D4F', WARN = '#B7791F', FAIL = '#B3261E', BG = '#EEF3F3';
const LAB = () => ({ name: process.env.LAB_NAME || 'Precision Calibration Laboratory', address: process.env.LAB_ADDRESS || '' });
const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(d));
const sgn = (n, d) => (n === null || n === undefined ? '-' : (n > 0 ? '+' : '') + Number(n).toFixed(d));
const dateOnly = (s) => (s ? String(s).slice(0, 10) : '-');
const RESULT_COLOR = { PASS: PASS, ADJUSTED: WARN, FAIL: FAIL };

function header(doc, title, right) {
  doc.rect(0, 0, doc.page.width, 92).fill(INK);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text(LAB().name, 40, 26, { width: 330 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#B9CBD6').text(LAB().address || 'ISO/IEC 17025 style calibration records', 40, 50, { width: 330 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(title, 300, 26, { width: doc.page.width - 340, align: 'right' });
  if (right) doc.font('Helvetica').fontSize(10).fillColor('#9FE1DC').text(right, 300, 48, { width: doc.page.width - 340, align: 'right' });
  doc.fillColor(INK);
  doc.y = 112;
}

function footer(doc, text) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 34;
    doc.moveTo(40, y - 6).lineTo(doc.page.width - 40, y - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(text, 40, y, { width: doc.page.width - 140, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - 100, y, { width: 60, align: 'right', lineBreak: false });
  }
}

function kv(doc, x, y, w, k, v) {
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(k, x, y, { width: w });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(v || '-', x, y + 11, { width: w });
}

// Generic table with page-break handling. cols: [{h, w, a?, f?(row)->string, color?(row)}]
function table(doc, cols, rows, opts = {}) {
  const x0 = 40, rowH = opts.rowH || 20, hdrH = 22;
  const total = cols.reduce((s, c) => s + c.w, 0);
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(x0, y, total, hdrH).fill(INK);
    let x = x0;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
    for (const c of cols) { doc.text(c.h, x + 5, y + 7, { width: c.w - 10, align: c.a || 'left', lineBreak: false }); x += c.w; }
    doc.y = y + hdrH;
  };
  drawHeader();
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(opts.empty || 'No records in this period.', x0 + 5, doc.y + 8);
    doc.y += 28; return;
  }
  rows.forEach((r, i) => {
    if (doc.y + rowH > doc.page.height - 60) { doc.addPage(); doc.y = 50; drawHeader(); }
    const y = doc.y;
    if (i % 2 === 0) doc.rect(x0, y, total, rowH).fill('#F6F9F9');
    let x = x0;
    for (const c of cols) {
      const val = c.f ? c.f(r) : r[c.k];
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(c.color ? c.color(r) : INK)
        .text(String(val ?? '-'), x + 5, y + 6, { width: c.w - 10, align: c.a || 'left', lineBreak: false, ellipsis: true });
      x += c.w;
    }
    doc.y = y + rowH;
  });
  doc.moveTo(x0, doc.y).lineTo(x0 + total, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.y += 10;
}

function sectionTitle(doc, t) {
  if (doc.y > doc.page.height - 120) { doc.addPage(); doc.y = 50; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEAL).text(t, 40, doc.y + 6);
  doc.y += 8;
}

// ---------------------------------------------------------------- Certificate
function buildCertificatePdf(c, watermark) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 10 }, bufferPages: true, info: { Title: `Calibration Certificate ${c.number}`, Author: LAB().name } });
  const d = c.decimals ?? 2;
  header(doc, 'CALIBRATION CERTIFICATE', c.number);

  const y0 = doc.y;
  kv(doc, 40, y0, 240, 'Customer', c.organisation ? `${c.customer_name} (${c.organisation})` : c.customer_name);
  kv(doc, 300, y0, 240, 'Instrument', c.equipment_name);
  kv(doc, 40, y0 + 38, 240, 'Serial no. / asset tag', c.serial_no);
  kv(doc, 300, y0 + 38, 240, 'Job token', c.token);
  kv(doc, 40, y0 + 76, 240, 'Date of calibration', dateOnly(c.issued_at));
  kv(doc, 300, y0 + 76, 240, 'Recommended recalibration by', dateOnly(c.valid_until));
  kv(doc, 40, y0 + 114, 240, 'Calibration standard', c.standard);
  kv(doc, 300, y0 + 114, 240, 'Reference equipment', c.reference_tool);
  const env = c.environment || {};
  kv(doc, 40, y0 + 152, 240, 'Ambient conditions', env.temperature || env.humidity ? `${env.temperature ?? '-'} C, ${env.humidity ?? '-'} % RH` : 'Not recorded');
  kv(doc, 300, y0 + 152, 240, 'Calibrated by', c.technician_name);
  doc.y = y0 + 196;

  // Result banner
  const col = RESULT_COLOR[c.result] || INK;
  doc.roundedRect(40, doc.y, 515, 46, 4).fill(col);
  const summary = { PASS: 'Instrument found within tolerance at every test point.',
    ADJUSTED: 'Found out of tolerance, adjusted and verified within tolerance (as-left).',
    FAIL: 'Instrument could not be brought within tolerance - do not use for measurement.' }[c.result];
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(`RESULT: ${c.result}`, 56, doc.y + 8, { continued: false });
  doc.font('Helvetica').fontSize(9).text(summary, 56, doc.y + 2, { width: 480 });
  doc.y += 30;

  sectionTitle(doc, `Measurement results (unit: ${c.unit})`);
  doc.y += 4;
  const pass = (v, r) => v !== null && Math.abs(v - r.value) <= r.mpe + 1e-9;
  table(doc, [
    { h: 'Reference', w: 62, a: 'right', f: (r) => fmt(r.value, d), bold: true },
    { h: 'As-found', w: 62, a: 'right', f: (r) => fmt(r.as_found, d) },
    { h: 'Error', w: 55, a: 'right', f: (r) => sgn(r.as_found === null ? null : r.as_found - r.value, d + 1) },
    { h: 'As-left', w: 62, a: 'right', f: (r) => fmt(r.as_left, d) },
    { h: 'Error', w: 55, a: 'right', f: (r) => sgn(r.as_left === null ? null : r.as_left - r.value, d + 1) },
    { h: 'MPE (+/-)', w: 62, a: 'right', f: (r) => fmt(r.mpe, d + 1) },
    { h: 'As-found', w: 78, a: 'center', f: (r) => (pass(r.as_found, r) ? 'Within' : 'OUT'), color: (r) => (pass(r.as_found, r) ? PASS : FAIL), bold: true },
    { h: 'As-left', w: 79, a: 'center', f: (r) => (r.as_left === null ? 'n/a' : pass(r.as_left, r) ? 'Within' : 'OUT'), color: (r) => (r.as_left === null ? MUTED : pass(r.as_left, r) ? PASS : FAIL), bold: true },
  ], c.data, { rowH: 22 });

  if (c.remarks) { sectionTitle(doc, 'Remarks'); doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(c.remarks, 40, doc.y + 4, { width: 515 }); doc.y += 8; }

  // Sign-off
  if (doc.y > doc.page.height - 190) { doc.addPage(); doc.y = 60; }
  doc.y += 18;
  const sy = doc.y;
  doc.moveTo(40, sy + 34).lineTo(250, sy + 34).strokeColor(INK).lineWidth(0.6).stroke();
  doc.moveTo(320, sy + 34).lineTo(555, sy + 34).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(c.technician_name, 40, sy + 38).text(c.approver_name || '(awaiting approval)', 320, sy + 38);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Calibration technician', 40, sy + 50).text(`Approved by (administrator)${c.approved_at ? ' - ' + dateOnly(c.approved_at) : ''}`, 320, sy + 50);
  doc.y = sy + 74;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Error = reading minus reference value. MPE = maximum permissible error for the stated reference point. This certificate may not be reproduced except in full without written approval of the laboratory. Results relate only to the item calibrated at the time of calibration.', 40, doc.y, { width: 515 });

  if (watermark) {
    const r = doc.bufferedPageRange();
    for (let i = r.start; i < r.start + r.count; i++) {
      doc.switchToPage(i);
      doc.save().rotate(-35, { origin: [300, 420] }).font('Helvetica-Bold').fontSize(54).fillColor('#B3261E').opacity(0.12)
        .text(watermark, 40, 380, { width: 520, align: 'center', lineBreak: false }).restore();
    }
  }
  footer(doc, `${LAB().name}  |  ${c.number}  |  Issued ${dateOnly(c.issued_at)}`);
  doc.end();
  return doc;
}

// ---------------------------------------------------------------- Activity report
function buildReportPdf(rep) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 10 }, bufferPages: true, info: { Title: rep.title, Author: LAB().name } });
  header(doc, rep.title, `${rep.from} to ${rep.to}`);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Scope: ${rep.scope}   |   Generated ${rep.generatedAt}`, 40, doc.y - 4);
  doc.y += 14;

  // KPI tiles
  const k = rep.kpis, tiles = [
    ['Checks done', k.checks], ['Out of tolerance', k.outOfTolerance], ['Tokens booked', k.tokensBooked],
    ['Tokens closed', k.tokensClosed], ['Certificates issued', k.certificates], ['Pass rate', k.passRate === null ? '-' : `${k.passRate}%`],
  ];
  const tw = 82, gap = 4.6, ty = doc.y;
  tiles.forEach(([lab, val], i) => {
    const x = 40 + i * (tw + gap);
    doc.roundedRect(x, ty, tw, 54, 4).fill(BG);
    doc.font('Helvetica-Bold').fontSize(19).fillColor(i === 1 && k.outOfTolerance > 0 ? FAIL : INK).text(String(val), x + 8, ty + 9, { width: tw - 16, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(lab, x + 8, ty + 36, { width: tw - 12, lineBreak: false });
  });
  doc.y = ty + 70;

  sectionTitle(doc, `Calibration tokens (${rep.tokens.length})`); doc.y += 4;
  table(doc, [
    { h: 'Token', w: 76, k: 'token', bold: true }, { h: 'Instrument', w: 112, k: 'equipment_name' }, { h: 'Serial', w: 62, k: 'serial_no' },
    { h: 'Customer', w: 76, k: 'customer_name' }, { h: 'Technician', w: 76, f: (r) => r.technician_name || '-' }, { h: 'Status', w: 113, k: 'status_label' },
  ], rep.tokens);

  sectionTitle(doc, `Certificates issued (${rep.certificates.length})`); doc.y += 4;
  table(doc, [
    { h: 'Certificate', w: 92, k: 'number', bold: true }, { h: 'Instrument', w: 128, k: 'equipment_name' }, { h: 'Token', w: 78, k: 'token' },
    { h: 'Result', w: 62, k: 'result', bold: true, color: (r) => RESULT_COLOR[r.result] }, { h: 'Approval', w: 70, k: 'approval_status' }, { h: 'Date', w: 85, f: (r) => dateOnly(r.issued_at) },
  ], rep.certificates);

  sectionTitle(doc, `Self-checks (${rep.checks.length})`); doc.y += 4;
  table(doc, [
    { h: 'Date', w: 70, f: (r) => dateOnly(r.created_at) }, { h: 'Instrument', w: 112, k: 'equipment_name' }, { h: 'Serial', w: 70, k: 'serial_no' },
    { h: 'Reference', w: 62, a: 'right', f: (r) => `${r.nominal_value} ${r.unit}` }, { h: 'Measured', w: 62, a: 'right', f: (r) => `${r.measured_value}` },
    { h: '% of MPE', w: 55, a: 'right', f: (r) => `${(r.error_ratio * 100).toFixed(0)}%` },
    { h: 'Verdict', w: 84, f: (r) => ({ within: 'Within', warning: 'Near limit', out: 'Out of tolerance' }[r.verdict]), bold: true,
      color: (r) => ({ within: PASS, warning: WARN, out: FAIL }[r.verdict]) },
  ], rep.checks, { rowH: 19 });

  footer(doc, `${LAB().name}  |  ${rep.title}  |  ${rep.from} to ${rep.to}`);
  doc.end();
  return doc;
}

module.exports = { buildCertificatePdf, buildReportPdf };
