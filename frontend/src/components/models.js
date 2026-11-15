// Procedural 3D models (no external assets). Each builder returns:
//   { group, anchors: { read: Vector3, ref: Vector3 }, set(value), tick(dt, t), cam: { pos, target } }
// - `read`  = where the user must LOOK to take the reading on the instrument under test
// - `ref`   = the reference standard that must be applied (gauge block, weight, calibrator ...)
// - `set(v)` moves the analog parts / reference displays to the selected standard test point `v`.
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: o.metal ?? 0.1, roughness: o.rough ?? 0.55, transparent: !!o.opacity, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0x000000, side: o.side });
const STEEL = () => mat(0xc3ccd4, { metal: 0.9, rough: 0.25 });
const DARK = () => mat(0x26323d, { metal: 0.3, rough: 0.5 });
const RUBBER = () => mat(0x1b2128, { rough: 0.9 });
const GLASS = () => mat(0xbfe3ee, { opacity: 0.28, rough: 0.05, metal: 0.0 });

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 36) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}
function tube(points, r, m) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (Array.isArray(p) ? V3(...p) : p)));
  const o = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 8, false), m); o.castShadow = true; return o;
}

// LCD / readout canvas. `placeholder` shows that the user must read the REAL instrument.
function display(w, h, o = {}) {
  const px = 512, canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = Math.round(px * h / w);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const bg = o.bg || '#cfe0c4', fg = o.fg || '#17261d';
  const set = (text, sub) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = Math.min(canvas.height * 0.62, (canvas.width * 0.9) / Math.max(4, String(text).length * 0.62));
    ctx.font = `600 ${size}px "Courier New", monospace`;
    ctx.fillText(text, canvas.width / 2, canvas.height * (sub ? 0.42 : 0.52));
    if (sub) { ctx.font = `600 ${canvas.height * 0.17}px sans-serif`; ctx.fillText(sub, canvas.width / 2, canvas.height * 0.84); }
    tex.needsUpdate = true;
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  set(o.text ?? '- - - -');
  return { mesh, set };
}
const rot = (o, axis) => { o.rotation[axis] = Math.PI / 2; return o; };
const PLACEHOLDER = '- - - -';
const fmt = (v, d) => Number(v).toFixed(d);

function finish(group, anchors, extra = {}) {
  group.updateMatrixWorld(true);
  const toLocal = (o) => (o.isVector3 ? o.clone() : group.worldToLocal(o.getWorldPosition(V3(0, 0, 0))));
  return { group, anchors: { read: toLocal(anchors.read), ref: toLocal(anchors.ref) }, ...extra };
}
const ease = (cur, tgt, dt, k = 7) => cur + (tgt - cur) * Math.min(1, dt * k);

// -------------------------------------------------------------------- Vernier caliper
function caliper(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range, mm = 5.6 / rMax, d = eq.decimals;
  const beam = box(8.4, 0.18, 0.5, STEEL(), 0, 0.85, 0); g.add(beam);
  g.add(box(0.2, 1.9, 0.5, STEEL(), -3.95, -0.05, 0));                 // fixed jaw
  g.add(box(0.9, 0.5, 0.5, STEEL(), -3.6, 1.2, 0));                    // upper fixed jaw
  for (let i = 0; i <= 30; i++) g.add(box(0.012, i % 2 ? 0.1 : 0.2, 0.02, DARK(), -3.85 + i * 5 * mm, 0.9, 0.26)); // scale ticks
  const slider = new THREE.Group();
  slider.add(box(1.25, 0.95, 0.66, mat(0x2f6f73, { metal: 0.4 }), 0.55, 0.85, 0));
  slider.add(box(0.2, 1.9, 0.5, STEEL(), 0, -0.05, 0));
  slider.add(box(0.8, 0.5, 0.5, STEEL(), 0.3, 1.2, 0));
  const lcd = display(0.95, 0.42); lcd.mesh.position.set(0.58, 0.93, 0.34); slider.add(lcd.mesh);
  g.add(slider);
  const block = box(1, 0.9, 0.42, mat(0x8895a0, { metal: 0.95, rough: 0.12 }), 0, -0.25, 0); g.add(block);
  const ground = cyl(7, 7, 0.05, mat(0xe6ecef), 0, -1.1, 0, 64); ground.receiveShadow = true; g.add(ground);
  let cur = 0, tgt = 0;
  const apply = () => {
    const gap = Math.max(0.04, cur * mm), x0 = -3.85;
    slider.position.set(x0 + 0.1 + gap, 0, 0);
    block.scale.x = gap; block.position.x = x0 + 0.1 + gap / 2; block.visible = cur > 0.05;
  };
  apply();   const m = finish(g, { read: V3(0, 0, 0), ref: V3(0, 0, 0) }, {
    cam: { pos: [0, 2.4, 9.2], target: [0, 0.2, 0] },
    set(v) { tgt = v; lcd.set(PLACEHOLDER, eq.unit); },
    tick(dt) {
      cur = ease(cur, tgt, dt); apply();
      m.anchors.read.set(slider.position.x + 0.58, 0.93, 0.4);
      m.anchors.ref.set(block.position.x, 0.35, 0.3);
    },
  });
  lcd.set(PLACEHOLDER, eq.unit); m.tick(1);
  return m;
}

// -------------------------------------------------------------------- Micrometer
function micrometer(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range, mm = 3.0 / rMax;
  const frame = mat(0x2f6f73, { metal: 0.5, rough: 0.4 });
  g.add(box(0.4, 3.0, 0.7, frame, -0.8, 0, 0));                     // left bar
  g.add(box(5.0, 0.4, 0.7, frame, 1.7, 1.3, 0));                    // top bar
  g.add(box(0.4, 1.9, 0.7, frame, 3.9, 0.45, 0));                   // right bar
  g.add(cyl(0.2, 0.2, 0.8, STEEL(), -0.4, 0, 0)); g.children.at(-1).rotation.z = Math.PI / 2; // anvil
  const barrel = cyl(0.36, 0.36, 4.4, STEEL(), 6.1, 0, 0); barrel.rotation.z = Math.PI / 2; g.add(barrel);
  for (let i = 0; i <= 25; i++) { const t = box(0.012, i % 5 === 0 ? 0.16 : 0.09, 0.02, DARK(), 4.1 + i * 0.12, 0.37, 0.0); t.position.z = 0.0; g.add(t); }
  const spindle = cyl(0.17, 0.17, 4.6, STEEL(), 0, 0, 0); spindle.rotation.z = Math.PI / 2; g.add(spindle);
  const thimble = cyl(0.55, 0.55, 2.3, mat(0x1d2830, { metal: 0.5, rough: 0.35 }), 0, 0, 0); thimble.rotation.z = Math.PI / 2; g.add(thimble);
  const lcd = display(1.0, 0.42); lcd.mesh.position.set(0, 0, 0.56); thimble.add(lcd.mesh); lcd.mesh.rotation.set(0, 0, 0);
  lcd.mesh.visible = false; // mechanical micrometer: read the thimble
  const rim = cyl(0.57, 0.57, 0.05, mat(0x9fe1dc, { emissive: 0x1a6b68 }), 0, 0, 0); rim.rotation.z = Math.PI / 2; g.add(rim);
  const block = box(1, 0.95, 0.95, mat(0x8895a0, { metal: 0.95, rough: 0.12 }), 0, 0, 0); g.add(block);
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 2.5, -1.7, 0, 64));
  let cur = 0, tgt = 0;
  const apply = () => {
    const gap = Math.max(0.04, cur * mm);
    spindle.position.x = gap + 2.3; thimble.position.x = 4.1 + gap + 1.15; rim.position.x = 4.1 + gap;
    block.scale.x = gap; block.position.x = gap / 2; block.visible = cur > 0.05;
  };
  const m = finish(g, { read: V3(0, 0, 0), ref: V3(0, 0, 0) }, {
    cam: { pos: [2.4, 2.2, 9.5], target: [2.6, 0, 0] },
    set(v) { tgt = v; },
    tick(dt) { cur = ease(cur, tgt, dt); apply(); m.anchors.read.set(4.1 + cur * mm, 0.62, 0.5); m.anchors.ref.set(cur * mm / 2, 0.7, 0.3); },
  });
  apply(); m.tick(1); return m;
}

// -------------------------------------------------------------------- Pressure gauge
function pressureGauge(eq) {
  const g = new THREE.Group(), [rMin, rMax] = eq.range;
  const toTheta = (v) => (-135 + 270 * (v - rMin) / (rMax - rMin)) * Math.PI / 180;   // clockwise from 12 o'clock
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#f7f9f9'; x.beginPath(); x.arc(256, 256, 256, 0, 7); x.fill();
  const steps = 20; x.strokeStyle = '#17212a'; x.fillStyle = '#17212a'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i <= steps; i++) {
    const v = rMin + (rMax - rMin) * i / steps, th = toTheta(v), major = i % 2 === 0;
    x.lineWidth = major ? 5 : 2.5; x.beginPath();
    x.moveTo(256 + Math.sin(th) * (major ? 190 : 205), 256 - Math.cos(th) * (major ? 190 : 205)); x.lineTo(256 + Math.sin(th) * 228, 256 - Math.cos(th) * 228); x.stroke();
    if (major) { x.font = 'bold 34px sans-serif'; x.fillText(fmt(v, 0), 256 + Math.sin(th) * 150, 256 - Math.cos(th) * 150); }
  }
  x.font = 'bold 30px sans-serif'; x.fillText(eq.unit, 256, 340); x.font = '22px sans-serif'; x.fillText('CLASS 1.0', 256, 380);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const body = cyl(1.9, 1.9, 0.8, STEEL(), 0, 0, 0); body.rotation.x = Math.PI / 2; g.add(body);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.1, 16, 64), STEEL()); bezel.position.z = 0.4; g.add(bezel);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.74, 64), new THREE.MeshBasicMaterial({ map: tex })); face.position.z = 0.41; g.add(face);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.74, 48), GLASS()); glass.position.z = 0.55; g.add(glass);
  const needle = new THREE.Group(); needle.position.z = 0.46;
  needle.add(box(0.07, 1.55, 0.03, mat(0xc0392b, { emissive: 0x300a07 }), 0, 0.55, 0)); needle.add(box(0.07, 0.4, 0.03, mat(0xc0392b), 0, -0.3, 0)); needle.add(rot(cyl(0.11, 0.11, 0.06, DARK(), 0, 0, 0), 'x'));
  g.add(needle);
  g.add(cyl(0.38, 0.38, 1.1, mat(0xb08d57, { metal: 0.8, rough: 0.3 }), 0, -2.4, 0));
  g.add(box(0.85, 0.3, 0.85, mat(0xb08d57, { metal: 0.8, rough: 0.3 }), 0, -2.85, 0));
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -3.4, 0, 64));
  let cur = rMin, tgt = rMin;
  const m = finish(g, { read: V3(0, 1.4, 0.5), ref: V3(0, -3.0, 0.2) }, {
    cam: { pos: [0, 0.2, 8.2], target: [0, -0.5, 0] },
    set(v) { tgt = v; },
    tick(dt) { cur = ease(cur, tgt, dt, 4); const th = toTheta(cur); needle.rotation.z = -th; m.anchors.read.set(Math.sin(th) * 1.25, Math.cos(th) * 1.25, 0.55); },
  });
  m.tick(1); return m;
}

// -------------------------------------------------------------------- Digital thermometer + dry-block
function thermometer(eq) {
  const g = new THREE.Group(), [rMin, rMax] = eq.range;
  g.add(box(1.7, 3.2, 0.55, mat(0x27323c, { rough: 0.5 }), -2.7, 0.3, 0));
  const lcd = display(1.35, 0.8); lcd.mesh.position.set(-2.7, 1.1, 0.29); g.add(lcd.mesh);
  for (let i = 0; i < 3; i++) g.add(rot(cyl(0.14, 0.14, 0.1, mat(0x9fe1dc), -3.15 + i * 0.45, -0.7, 0.3), 'x'));
  const block = box(2.4, 1.7, 2.2, mat(0x56626c, { metal: 0.6, rough: 0.4 }), 1.9, -0.25, 0); g.add(block);
  const top = box(2.4, 0.12, 2.2, mat(0x3b82c4, { emissive: 0x0b2a4a }), 1.9, 0.66, 0); g.add(top);
  g.add(cyl(0.2, 0.2, 0.15, mat(0x0c1015), 1.9, 0.74, 0));
  g.add(cyl(0.07, 0.07, 2.3, STEEL(), 1.9, 1.7, 0));                          // reference probe/probe under test
  const rd = display(1.6, 0.6, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(1.9, -0.35, 1.11); g.add(rd.mesh);
  g.add(tube([[-2.7, -1.3, 0.2], [-1.6, -2.0, 0.8], [0.2, -1.2, 1.0], [1.5, 0.4, 0.4], [1.9, 2.3, 0]], 0.05, RUBBER()));
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -1.15, 0, 64));
  const cold = new THREE.Color(0x3b82c4), hot = new THREE.Color(0xe0452b);
  let cur = rMin, tgt = rMin;
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, {
    cam: { pos: [-0.5, 2.0, 9.0], target: [-0.3, 0.2, 0] },
    set(v) { tgt = v; lcd.set(PLACEHOLDER, eq.unit === 'C' ? 'deg C' : eq.unit); rd.set(`${fmt(v, 1)} C`, 'DRY-BLOCK SETPOINT'); },
    tick(dt) { cur = ease(cur, tgt, dt, 3); const f = (cur - rMin) / (rMax - rMin); top.material.color.copy(cold).lerp(hot, f); top.material.emissive.copy(cold).lerp(hot, f).multiplyScalar(0.25); },
  });
  lcd.set(PLACEHOLDER, 'deg C'); m.set(rMin); return m;
}

// -------------------------------------------------------------------- Digital scale
function scale(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range;
  g.add(box(3.6, 0.45, 2.8, mat(0xdfe5e8, { rough: 0.5 }), 0, 0, -0.3));
  g.add(box(2.7, 0.1, 2.1, STEEL(), 0, 0.27, -0.3));
  const tower = box(2.5, 0.9, 0.5, mat(0x27323c), 0, 0.15, 1.35); tower.rotation.x = -0.5; g.add(tower);
  const lcd = display(1.9, 0.55); lcd.mesh.position.set(0, 0.0, 0.26); tower.add(lcd.mesh);
  const weight = cyl(0.5, 0.58, 0.8, mat(0xb08d57, { metal: 0.85, rough: 0.28 }), 0, 0.7, -0.3); g.add(weight);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat(0xb08d57, { metal: 0.85, rough: 0.28 })); knob.position.set(0, 1.2, -0.3); g.add(knob);
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -0.26, 0, 64));
  let cur = 0, tgt = 0;
  const m = finish(g, { read: lcd.mesh, ref: weight }, {
    cam: { pos: [0, 3.6, 7.8], target: [0, 0.2, 0.2] },
    set(v) { tgt = v; lcd.set(PLACEHOLDER, eq.unit); },
    tick(dt) { cur = ease(cur, tgt, dt); const s = 0.55 + 0.75 * Math.cbrt(cur / rMax); weight.scale.set(s, s, s); weight.position.y = 0.32 + 0.4 * s; knob.position.y = weight.position.y + 0.4 * s + 0.1; knob.scale.set(s, s, s); m.anchors.ref.copy(weight.position).add(V3(0, 0.1, 0)); },
  });
  m.set(0); m.tick(1); return m;
}

// -------------------------------------------------------------------- Torque wrench + tester
function torqueWrench(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range;
  g.add(rot(cyl(0.3, 0.3, 4.4, mat(0x1b2128, { rough: 0.9 }), 2.6, 0.4, 0), 'z'));
  g.add(rot(cyl(0.38, 0.38, 2.6, mat(0xc0392b, { metal: 0.4, rough: 0.4 }), -0.6, 0.4, 0), 'z'));
  g.add(box(1.1, 1.0, 0.8, STEEL(), -2.4, 0.4, 0));
  g.add(box(0.4, 0.4, 0.4, STEEL(), -2.4, -0.3, 0));
  const lcd = display(1.15, 0.5); lcd.mesh.position.set(-0.7, 0.4, 0.4); g.add(lcd.mesh);
  const tester = box(2.0, 1.5, 1.6, mat(0x4a5864, { metal: 0.5 }), -2.4, -1.4, 0); g.add(tester);
  const rd = display(1.6, 0.6, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(-2.4, -1.4, 0.81); g.add(rd.mesh);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 20), mat(0x0e7c7b)); arrow.position.set(4.3, 0.4, 1.2); arrow.rotation.x = Math.PI / 2; g.add(arrow);
  g.add(box(0.07, 0.07, 0.9, mat(0x0e7c7b), 4.3, 0.4, 0.75));
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0.8, -2.2, 0, 64));
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, {
    cam: { pos: [1.2, 2.6, 9.5], target: [0.8, -0.1, 0] },
    set(v) { lcd.set(PLACEHOLDER, 'N.m'); rd.set(`${fmt(v, 1)} N.m`, 'TORQUE TESTER'); }, tick() {},
  });
  lcd.set(PLACEHOLDER, 'N.m'); return m;
}

// -------------------------------------------------------------------- Multimeter + calibrator
function multimeter(eq) {
  const g = new THREE.Group();
  g.add(box(2.4, 4.2, 0.85, mat(0xf2b705, { rough: 0.5 }), -2.4, 0.4, 0));
  g.add(box(2.1, 3.9, 0.9, mat(0x1b2128, { rough: 0.9 }), -2.4, 0.4, -0.05));
  g.add(box(2.1, 3.9, 0.7, mat(0xf2b705, { rough: 0.5 }), -2.4, 0.4, 0.12));
  const lcd = display(1.7, 0.85); lcd.mesh.position.set(-2.4, 1.6, 0.48); g.add(lcd.mesh);
  const dial = cyl(0.72, 0.72, 0.15, mat(0x27323c), -2.4, -0.2, 0.5); dial.rotation.x = Math.PI / 2; g.add(dial);
  g.add(box(0.1, 0.62, 0.05, mat(0xffffff), -2.4, -0.2 + 0.2, 0.6));
  for (let i = 0; i < 3; i++) { const j = cyl(0.14, 0.14, 0.12, DARK(), -3.0 + i * 0.6, -1.55, 0.45); j.rotation.x = Math.PI / 2; g.add(j); }
  const cal = box(2.8, 1.9, 1.5, mat(0x4a5864, { metal: 0.5 }), 2.3, -0.9, 0); g.add(cal);
  const rd = display(2.2, 0.8, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(2.3, -0.5, 0.76); g.add(rd.mesh);
  g.add(rot(cyl(0.13, 0.13, 0.12, mat(0xc0392b), 1.6, -1.55, 0.76), 'x'));
  g.add(rot(cyl(0.13, 0.13, 0.12, DARK(), 2.1, -1.55, 0.76), 'x'));
  g.add(tube([[-2.4, -1.55, 0.5], [-1.8, -2.5, 1.2], [0.3, -2.6, 1.3], [1.6, -1.6, 0.9]], 0.055, mat(0xc0392b)));
  g.add(tube([[-1.8, -1.55, 0.5], [-1.0, -2.7, 1.4], [1.0, -2.8, 1.4], [2.1, -1.6, 0.9]], 0.055, RUBBER()));
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -2.3, 0, 64));
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, {
    cam: { pos: [0, 1.2, 9.8], target: [0, 0, 0] },
    set(v) { lcd.set(PLACEHOLDER, 'V DC'); rd.set(`${fmt(v, 3)} V`, 'CALIBRATOR OUTPUT'); }, tick() {},
  });
  lcd.set(PLACEHOLDER, 'V DC'); return m;
}

// -------------------------------------------------------------------- pH meter + buffer
function phMeter(eq) {
  const g = new THREE.Group(), [rMin, rMax] = eq.range;
  g.add(box(1.8, 3.4, 0.6, mat(0xe9eef0, { rough: 0.5 }), -2.6, 0.5, 0));
  const lcd = display(1.4, 0.9); lcd.mesh.position.set(-2.6, 1.3, 0.31); g.add(lcd.mesh);
  for (let i = 0; i < 3; i++) g.add(rot(cyl(0.15, 0.15, 0.1, mat(0x0e7c7b), -3.1 + i * 0.5, -0.4, 0.31), 'x'));
  g.add(box(0.25, 4.4, 0.25, DARK(), 0.4, 0.2, -0.9)); g.add(box(1.7, 0.2, 0.2, DARK(), 1.2, 1.9, -0.9)); g.add(box(1.6, 0.2, 1.6, DARK(), 0.4, -1.9, -0.9));
  const electrode = cyl(0.12, 0.12, 3.4, GLASS(), 2.0, 0.3, 0); g.add(electrode);
  g.add(cyl(0.16, 0.16, 0.5, mat(0x0e7c7b), 2.0, 2.2, 0));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat(0xbfe3ee, { opacity: 0.5 })); bulb.position.set(2.0, -1.4, 0); g.add(bulb);
  g.add(tube([[-2.0, 0.0, 0.3], [-1.0, 0.9, 1.0], [1.0, 2.7, 0.7], [2.0, 2.3, 0]], 0.04, RUBBER()));
  const beaker = cyl(1.0, 1.0, 2.1, GLASS(), 2.0, -1.25, 0, 40); g.add(beaker);
  const liquid = cyl(0.95, 0.95, 1.4, mat(0x2fb36d, { opacity: 0.7 }), 2.0, -1.6, 0, 40); g.add(liquid);
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -2.35, 0, 64));
  const lab = display(0.9, 0.5, { bg: '#ffffff' }); lab.mesh.position.set(2.0, -1.2, 1.02); g.add(lab.mesh);
  const m = finish(g, { read: lcd.mesh, ref: lab.mesh }, {
    cam: { pos: [-0.2, 1.8, 9.2], target: [-0.2, 0, 0] },
    set(v) { lcd.set(PLACEHOLDER, 'pH'); lab.set(fmt(v, 2), 'pH BUFFER'); const f = (v - rMin) / (rMax - rMin); liquid.material.color.setHSL(0.02 + 0.78 * f, 0.65, 0.5); }, tick() {},
  });
  lcd.set(PLACEHOLDER, 'pH'); return m;
}

// -------------------------------------------------------------------- Flow meter + reference rig
function flowMeter(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range;
  const pipe = cyl(0.55, 0.55, 9, mat(0x8895a0, { metal: 0.85, rough: 0.3 }), 0, 0, 0); pipe.rotation.z = Math.PI / 2; g.add(pipe);
  for (const x of [-1.5, 1.5]) { const f = cyl(0.95, 0.95, 0.25, STEEL(), x, 0, 0); f.rotation.z = Math.PI / 2; g.add(f); }
  const win = cyl(0.62, 0.62, 2.8, GLASS(), 0, 0, 0); win.rotation.z = Math.PI / 2; g.add(win);
  const rotor = new THREE.Group(); for (let i = 0; i < 4; i++) { const b = box(0.1, 0.9, 0.5, mat(0x0e7c7b), 0, 0, 0); b.rotation.x = i * Math.PI / 4; rotor.add(b); } g.add(rotor);
  g.add(box(2.2, 1.1, 1.5, mat(0x2f6f73, { metal: 0.4 }), 0, 1.35, 0));
  const lcd = display(1.7, 0.7); lcd.mesh.position.set(0, 1.4, 0.76); g.add(lcd.mesh);
  for (const x of [-3.2, 3.2]) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 20), mat(0x0e7c7b)); a.rotation.z = -Math.PI / 2; a.position.set(x, 0, 0.75); g.add(a); }
  const rig = box(2.2, 1.7, 1.5, mat(0x4a5864, { metal: 0.5 }), -5.0, 0, 0); g.add(rig);
  const rd = display(1.8, 0.7, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(-5.0, 0.2, 0.76); g.add(rd.mesh);
  g.add(cyl(9, 9, 0.05, mat(0xe6ecef), -0.3, -1.2, 0, 64));
  let speed = 0, tgtSpeed = 0;
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, {
    cam: { pos: [-1.2, 2.6, 11.5], target: [-1.2, 0.3, 0] },
    set(v) { tgtSpeed = 1 + 11 * v / rMax; lcd.set(PLACEHOLDER, eq.unit); rd.set(fmt(v, 2), 'REF FLOW ' + eq.unit); },
    tick(dt) { speed = ease(speed, tgtSpeed, dt, 3); rotor.rotation.x += speed * dt; },
  });
  lcd.set(PLACEHOLDER, eq.unit); return m;
}

// -------------------------------------------------------------------- Strain gauge on a cantilever + bridge amplifier
function strainGauge(eq) {
  const g = new THREE.Group(), [, rMax] = eq.range, N = 24, L = 5.2, x0 = -3.6;
  g.add(box(0.7, 2.4, 1.6, mat(0x56626c, { metal: 0.6 }), x0 - 0.35, -0.1, 0));
  const segs = []; for (let i = 0; i < N; i++) { const s = box(L / N * 1.06, 0.34, 1.1, mat(0xaab6bf, { metal: 0.5, rough: 0.35 }), 0, 0, 0); segs.push(s); g.add(s); }
  const foilTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#e3b04b'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#7a4a05'; x.lineWidth = 6;
    x.beginPath(); for (let i = 0; i < 8; i++) { const y = 18 + i * 13; x.moveTo(30, y); x.lineTo(226, y); x.lineTo(226, y + 6.5); x.lineTo(30, y + 6.5); } x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const foil = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.45), new THREE.MeshBasicMaterial({ map: foilTex })); foil.rotation.x = -Math.PI / 2; foil.position.set(0, 0.175, 0); segs[3].add(foil);
  const amp = box(2.0, 1.4, 1.2, mat(0x4a5864, { metal: 0.5 }), 3.9, 0.9, 0); g.add(amp);
  const lcd = display(1.6, 0.65); lcd.mesh.position.set(3.9, 1.0, 0.61); g.add(lcd.mesh);
  const sim = box(2.0, 1.1, 1.2, mat(0x2f6f73, { metal: 0.4 }), 3.9, -1.0, 0); g.add(sim);
  const rd = display(1.6, 0.6, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(3.9, -1.0, 0.61); g.add(rd.mesh);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 20), mat(0xc0392b)); arrow.rotation.x = Math.PI; g.add(arrow);
  const shaft = box(0.07, 0.8, 0.07, mat(0xc0392b)); g.add(shaft);
  const wire = tube([[x0 + 1.0, 0.25, 0.3], [0.5, 0.8, 0.8], [2.4, 1.2, 0.6], [2.9, 1.0, 0.4]], 0.035, mat(0xc0392b)); g.add(wire);
  g.add(cyl(8, 8, 0.05, mat(0xe6ecef), 0.5, -2.3, 0, 64));
  const w = (s) => -(3 * s * s - s * s * s) / 2;          // cantilever deflection shape, w(1) = -1
  let cur = 0, tgt = 0;
  const apply = () => {
    const d = 1.1 * cur / rMax; let prev = V3(x0, 0, 0);
    for (let i = 0; i < N; i++) {
      const s1 = (i + 1) / N, p1 = V3(x0 + s1 * L, d * w(s1), 0), mid = prev.clone().add(p1).multiplyScalar(0.5), dv = p1.clone().sub(prev);
      segs[i].position.copy(mid); segs[i].rotation.z = Math.atan2(dv.y, dv.x); prev = p1;
    }
    const tip = V3(x0 + L, -d, 0); arrow.position.set(tip.x, tip.y + 1.45, 0); shaft.position.set(tip.x, tip.y + 0.95, 0);
  };
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, {
    cam: { pos: [0.6, 2.2, 10.5], target: [0.4, 0.1, 0] },
    set(v) { tgt = v; lcd.set(PLACEHOLDER, 'ue'); rd.set(fmt(v, 0) + ' ue', 'STRAIN SIMULATOR'); },
    tick(dt) { cur = ease(cur, tgt, dt, 4); apply(); },
  });
  lcd.set(PLACEHOLDER, 'ue'); apply(); return m;
}

// -------------------------------------------------------------------- Generic (custom equipment added by an admin)
function generic(eq) {
  const g = new THREE.Group();
  g.add(box(2.6, 3.2, 1.0, mat(0x2f6f73, { metal: 0.4 }), -1.6, 0.4, 0));
  const lcd = display(2.0, 0.9); lcd.mesh.position.set(-1.6, 1.2, 0.51); g.add(lcd.mesh);
  g.add(rot(cyl(0.3, 0.3, 0.2, DARK(), -1.6, -0.5, 0.52), 'x'));
  const ref = box(2.4, 1.6, 1.2, mat(0x4a5864, { metal: 0.5 }), 2.2, -0.3, 0); g.add(ref);
  const rd = display(1.9, 0.7, { bg: '#10202b', fg: '#7be0d6' }); rd.mesh.position.set(2.2, -0.1, 0.61); g.add(rd.mesh);
  g.add(tube([[-0.3, -0.4, 0.4], [0.5, -1.2, 0.8], [1.2, -0.7, 0.7]], 0.05, RUBBER()));
  g.add(cyl(7, 7, 0.05, mat(0xe6ecef), 0, -1.5, 0, 64));
  const m = finish(g, { read: lcd.mesh, ref: rd.mesh }, { cam: { pos: [0.4, 2.0, 8.5], target: [0.3, 0.2, 0] },
    set(v) { lcd.set(PLACEHOLDER, eq.unit); rd.set(`${v} ${eq.unit}`, 'REFERENCE'); }, tick() {} });
  lcd.set(PLACEHOLDER, eq.unit); return m;
}

const BUILDERS = { vernier_caliper: caliper, micrometer, pressure_gauge: pressureGauge, thermometer, digital_scale: scale,
  torque_wrench: torqueWrench, multimeter, ph_meter: phMeter, flow_meter: flowMeter, strain_gauge: strainGauge };

export function buildModel(equipment) {
  const b = BUILDERS[equipment.model3d] || BUILDERS[equipment.key] || generic;
  return b({ key: equipment.key, unit: equipment.unit, decimals: equipment.decimals, range: [equipment.range_min, equipment.range_max] });
}
