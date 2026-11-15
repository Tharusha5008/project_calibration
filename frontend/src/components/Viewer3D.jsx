import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel } from './models.js';

// 3D instrument viewer. Shows the instrument, the reference standard, and callouts that say
// WHERE to read (teal) and WHAT to apply (amber) for the selected standard point.
export default function Viewer3D({ equipment, point, readText, refText }) {
  const mount = useRef(null), readEl = useRef(null), refEl = useRef(null);
  const api = useRef({});
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    const el = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setWebgl(false); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6cc, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(5, 9, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    scene.add(sun);

    const model = buildModel(equipment);
    scene.add(model.group);

    // pulsing ring around the reading point
    const ringTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      x.strokeStyle = '#14b8a6'; x.lineWidth = 9; x.beginPath(); x.arc(64, 64, 52, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(20,184,166,.35)'; x.lineWidth = 16; x.beginPath(); x.arc(64, 64, 52, 0, 7); x.stroke(); return new THREE.CanvasTexture(c); })();
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, depthTest: false, transparent: true })); ring.renderOrder = 10; scene.add(ring);
    const refRing = ring.clone(); refRing.material = new THREE.SpriteMaterial({ map: ringTex, depthTest: false, transparent: true, color: 0xf0a020 }); scene.add(refRing);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI * 0.55;
    const home = { pos: V(model.cam.pos), target: V(model.cam.target) };
    let goal = null, touched = false; // goal = animated camera move {pos, target}
    controls.addEventListener('start', () => { touched = true; });

    // Fit the whole instrument (ignoring the big floor disc) into view for the current aspect ratio.
    const fit = () => {
      const box = new THREE.Box3();
      model.group.updateMatrixWorld(true);
      model.group.traverse((o) => { if (o.isMesh && !(o.geometry.parameters && o.geometry.parameters.height === 0.05)) box.expandByObject(o); });
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const d = Math.max(size.y / 2 / t, size.x / 2 / (t * camera.aspect)) * 1.3 + size.z / 2 + 0.5;
      home.target.copy(c); home.pos.copy(c).add(new THREE.Vector3(0.1 * d, 0.3 * d, d).normalize().multiplyScalar(d));
      controls.maxDistance = d * 2.5;
      if (!touched && !goal) { camera.position.copy(home.pos); controls.target.copy(home.target); }
    };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); fit(); };
    camera.position.copy(home.pos); controls.target.copy(home.target);
    resize(); const ro = new ResizeObserver(resize); ro.observe(el);

    const clock = new THREE.Clock(); let raf; const tmp = new THREE.Vector3();
    const place = (anchor, node, above) => {
      if (!node) return;
      tmp.copy(anchor).project(camera);
      const w = el.clientWidth, h = el.clientHeight, x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      const nw = node.offsetWidth, nh = node.offsetHeight;
      const px = Math.max(8, Math.min(w - nw - 8, x - nw / 2)), py = Math.max(8, Math.min(h - nh - 44, above ? y - nh - 34 : y + 34));
      node.style.transform = `translate(${px}px, ${py}px)`;
      node.style.opacity = tmp.z < 1 ? 1 : 0;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      model.tick?.(dt, t);
      if (goal) { camera.position.lerp(goal.pos, 0.08); controls.target.lerp(goal.target, 0.08); if (camera.position.distanceTo(goal.pos) < 0.02) goal = null; }
      controls.update();
      const a = model.group.localToWorld(model.anchors.read.clone()), b = model.group.localToWorld(model.anchors.ref.clone());
      const pulse = 0.55 + 0.12 * Math.sin(t * 4); ring.position.copy(a); ring.scale.setScalar(pulse * 1.1); refRing.position.copy(b); refRing.scale.setScalar(pulse * 0.95);
      place(a, readEl.current, true); place(b, refEl.current, false);
      renderer.render(scene, camera);
    };
    loop();

    api.current = {
      model,
      reset: () => { goal = { pos: home.pos.clone(), target: home.target.clone() }; },
      focus: () => { const a = model.group.localToWorld(model.anchors.read.clone()); goal = { pos: a.clone().add(new THREE.Vector3(0.6, 0.5, 4.2)), target: a.clone() }; },
    };
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [equipment]);

  useEffect(() => { if (point) api.current.model?.set(point.value); }, [point, equipment]);

  if (!webgl) return <div className="viewer fallback">3D view needs WebGL, which this browser has disabled. The measurement guide on the right still applies.</div>;
  return (
    <div className="viewer" ref={mount}>
      <div className="callout read" ref={readEl}><b>Read here</b><span>{readText}</span></div>
      <div className="callout apply" ref={refEl}><b>Apply</b><span>{refText}</span></div>
      <div className="viewer-tools">
        <button type="button" className="btn small" onClick={() => api.current.focus?.()}>Zoom to reading</button>
        <button type="button" className="btn small ghost" onClick={() => api.current.reset?.()}>Reset view</button>
      </div>
      <div className="viewer-hint">Drag to rotate - scroll to zoom</div>
    </div>
  );
}
function V([x, y, z]) { return new THREE.Vector3(x, y, z); }
