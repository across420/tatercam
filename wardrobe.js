// TaterCam wardrobe. Every item is built from code and shaped to fit the potato.
// Each item: { id, slot, name, build() -> { obj, update(st), steam? } }
// st = { t, dt, jaw, smile, rot, drot:{x,y,z}, kick, visorDown, nvgDown }
import * as THREE from 'three';
import { FACE, TOP, outerPoint, shapeNormal, surfaceAt, ringPoint, halfWidthAt, smooth, vnoise } from './tater.js';

const TAU = Math.PI * 2, Z = new THREE.Vector3(0, 0, 1);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...o });
const gold = () => std(0xffcf5a, { metalness: 1, roughness: 0.22 });
const SMOOTH = { lumps: false, craters: false };

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
}
const camoTex = (base, blobs) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = blobs[i % blobs.length]; const x = rnd() * w, y = rnd() * h, rx = 8 + rnd() * 26, ry = 5 + rnd() * 14, r = rnd() * 3;
    for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, r, 0, TAU); g.fill(); }
  }
}, [3, 2]);
const knitTex = color => canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = gr; g.fillRect(x, 0, 8, h); }
  for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, y, w, 2); }
}, [6, 3]);
const stripeTex = (colors, n = 8) => canvasTex(256, 256, (g, w, h) => {
  const sw = w / n;
  for (let i = -n; i < n * 2; i++) { g.fillStyle = colors[((i % colors.length) + colors.length) % colors.length]; g.beginPath(); g.moveTo(i * sw, 0); g.lineTo(i * sw + sw, 0); g.lineTo(i * sw + sw - h, h); g.lineTo(i * sw - h, h); g.fill(); }
});
const patchTex = (text, bg, fg) => canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.font = 'bold 64px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
});

// ---------- Fitting helpers ----------
const tmpD = new THREE.Vector3(), tmpP = new THREE.Vector3();
function conform(geo, k) {           // wrap a unit-sphere piece around the potato, k = how far out
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { tmpD.fromBufferAttribute(p, i).normalize(); outerPoint(tmpD, tmpP).multiplyScalar(k); p.setXYZ(i, tmpP.x, tmpP.y, tmpP.z); }
  geo.computeVertexNormals(); return geo;
}
const shell = (k, thetaLen, mat, t0 = 0) => new THREE.Mesh(conform(new THREE.SphereGeometry(1, 72, 40, 0, TAU, t0, thetaLen), k), mat);
const dirAt = (theta, phi) => new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
function ring(k, theta, tube, mat) {
  const pts = []; for (let i = 0; i < 96; i++) pts.push(outerPoint(dirAt(theta, i / 96 * TAU)).multiplyScalar(k));
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, tube, 8, true), mat);
}
function placeOn(mesh, k, dir, off = 0.01) {
  const d = new THREE.Vector3(...dir).normalize(), n = shapeNormal(d, SMOOTH);
  mesh.position.copy(outerPoint(d).multiplyScalar(k)).addScaledVector(n, off);
  mesh.quaternion.setFromUnitVectors(Z, n); return mesh;
}
const onFace = (mesh, x, y, off) => { const s = surfaceAt(x, y, SMOOTH); mesh.position.copy(s.p).addScaledVector(s.n, off); mesh.quaternion.setFromUnitVectors(Z, s.n); return mesh; };
function band(y0, y1, extra, mat, crinkle = 0) {   // a wrap around the lower body that follows its shape
  const R = 28, C = 112, pos = [], uv = [], index = [];
  for (let j = 0; j <= R; j++) {
    const y = y0 + (y1 - y0) * j / R;
    for (let i = 0; i <= C; i++) {
      const a = i / C * TAU, p = ringPoint(y, a, extra);
      let px = p.x, py = p.y, pz = p.z;
      if (crinkle) {
        const c = 0.028 * Math.sin(a * 23 + y * 15) + 0.018 * Math.sin(a * 41 - y * 31) + 0.012 * Math.sin(a * 67 + y * 47);
        const hz = Math.hypot(px, pz) || 1; px += px / hz * c; pz += pz / hz * c;
        if (j === R) py += 0.05 * Math.sin(a * 7) + 0.025 * Math.sin(a * 13 + 1);
      }
      pos.push(px, py, pz); uv.push(i / C * 4, j / R);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) { const a = j * (C + 1) + i, b = a + C + 1; index.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function loop(y, extra, tube, mat, sag = 0) {
  const pts = []; for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, fr = Math.max(0, Math.cos(a)); pts.push(ringPoint(y - sag * fr * fr, a, extra)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, tube, 12, true), mat);
}
function spring(k = 80, d = 9) { return { x: 0, v: 0, step(dt, target, kick = 0) { this.v += kick + ((target - this.x) * k - this.v * d) * dt; this.x += this.v * dt; if (!isFinite(this.x) || !isFinite(this.v)) { this.x = 0; this.v = 0; } this.x = Math.max(-3, Math.min(3, this.x)); return this.x; } }; }
function strobe(parent, pos) {
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }));
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.1), std(0x222222)); box.position.copy(pos); light.position.set(0, 0.05, 0); box.add(light); parent.add(box);
  return t => { light.material.emissiveIntensity = (t % 1.2) < 0.08 ? 4 : 0; };
}
const eyeTheta = Math.acos(FACE.eyeY / TOP);   // where the eyes sit on the sphere map

// ======================= HEAD =======================
const HEAD = [
  { id: 'toppings', name: '🧈 Butter & Sour Cream', build() {
    const g = new THREE.Group();
    const top = outerPoint(new THREE.Vector3(0, 1, 0));
    const butter = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.32, 4, 2, 4), std(0xffd84d, { roughness: 0.3 }));
    butter.position.set(-0.15, top.y - 0.02, 0.02); butter.rotation.set(0.12, 0.4, 0.25); g.add(butter);
    const cream = new THREE.Group(); cream.position.set(0.17, top.y - 0.06, 0.1);
    const cm = std(0xfbfaf4, { roughness: 0.5 });
    const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), cm); cream.add(blob);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.15, 16), cm); peak.position.y = 0.14; cream.add(peak);
    const chive = std(0x3f9d3a, { roughness: 0.6 });
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.07, 8), chive); const a = i * 2.4, rr = 0.05 + (i % 3) * 0.05; c.position.set(Math.cos(a) * rr, 0.12 - rr * 0.35, Math.sin(a) * rr); c.rotation.set(Math.PI / 2, 0, a); cream.add(c); }
    g.add(cream);
    const jig = spring(140, 7); let prevJaw = 0;
    return { obj: g, steam: true, update(st) {
      const x = jig.step(st.dt, 0, (st.jaw - prevJaw) * 6 + st.kick + Math.abs(st.drot.y) * 0.02); prevJaw = st.jaw;
      blob.scale.set(0.24 * (1 - x * 0.4), 0.13 * (1 + x), 0.22 * (1 - x * 0.4)); peak.rotation.z = 0.3 + x * 1.5;
    } };
  } },

  { id: 'highcut', name: '🪖 High-Cut Tactical Helmet', build() {
    const g = new THREE.Group();
    const tan = std(0xa8936c, { roughness: 0.82, side: THREE.DoubleSide });
    const th = eyeTheta - 0.42;
    g.add(shell(1.1, th, tan)); g.add(ring(1.1, th, 0.028, std(0x3b3528, { roughness: 0.9 })));
    const railMat = std(0x2e2b26, { roughness: 0.55, metalness: 0.35 });
    for (const sx of [-1, 1]) g.add(placeOn(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.11, 0.06), railMat), 1.1, [sx, 0.55, 0], 0.03));
    const shroud = placeOn(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.06), railMat), 1.1, [0, 0.62, 0.78], 0.03); g.add(shroud);
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.03), std(0x111111)); notch.position.set(0, -0.03, 0.035); shroud.add(notch);
    const patch = placeOn(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshStandardMaterial({ map: patchTex('TATER', '#3b3a2e', '#d8c690'), roughness: 0.95 })), 1.1, [0, 0.55, -0.83], 0.012);
    patch.rotateZ(Math.PI); g.add(patch);
    g.add(placeOn(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.1), std(0x6f6248, { roughness: 0.95 })), 1.1, [0, 0.35, -1], 0.05));
    const blink = strobe(g, outerPoint(new THREE.Vector3(0, 1, -0.25).normalize()).multiplyScalar(1.1).add(new THREE.Vector3(0, 0.03, 0)));
    return { obj: g, update(st) { blink(st.t); } };
  } },

  { id: 'altyn', name: '🛡️ Heavy Assault Helmet + Visor (V)', build() {
    const g = new THREE.Group();
    const olive = std(0x5a5f44, { roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    const th = eyeTheta - 0.2;
    g.add(shell(1.12, th, olive)); g.add(ring(1.12, th, 0.035, std(0x2d2f24, { roughness: 0.8 })));
    const visor = new THREE.Group(); g.add(visor);
    const vm = std(0x646a4c, { roughness: 0.42, metalness: 0.5, side: THREE.DoubleSide });
    const part = (t0, t1, p0 = Math.PI / 2 - 1.0, pl = 2.0) => new THREE.Mesh(conform(new THREE.SphereGeometry(1, 56, 16, p0, pl, t0, t1 - t0), 1.2), vm);
    visor.add(part(eyeTheta - 0.34, eyeTheta - 0.08)); visor.add(part(eyeTheta + 0.07, eyeTheta + 0.75));
    for (const sx of [-1, 1]) {
      visor.add(part(eyeTheta - 0.09, eyeTheta + 0.08, Math.PI / 2 + sx * 0.97 - 0.06, 0.12));
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 20), std(0x3c3f30, { metalness: 0.6, roughness: 0.4 }));
      bolt.rotation.z = Math.PI / 2; bolt.position.copy(ringPoint(FACE.eyeY + 0.12, sx * Math.PI / 2, 0.2)); g.add(bolt);
    }
    let a = 0;
    return { obj: g, update(st) { a += ((st.visorDown ? 0 : -1.05) - a) * Math.min(1, st.dt * 7); visor.rotation.x = a; } };
  } },

  { id: 'ratnik', name: '🪖 Ratnik Helmet (camo)', build() {
    const g = new THREE.Group();
    const cover = new THREE.MeshStandardMaterial({ map: camoTex('#56603f', ['#6e6a45', '#3b412b', '#2b2c22', '#7b6f50']), roughness: 0.95, side: THREE.DoubleSide });
    const th = eyeTheta - 0.3;
    g.add(shell(1.11, th, cover)); g.add(ring(1.11, th, 0.04, std(0x3f4530, { roughness: 0.95 })));
    g.add(ring(1.13, th * 0.62, 0.028, std(0x222222, { roughness: 0.8 })));
    return { obj: g, update() {} };
  } },

  { id: 'beanie', name: '🧶 Beanie', build() {
    const g = new THREE.Group(); const th = eyeTheta - 0.38;
    g.add(shell(1.08, th, new THREE.MeshStandardMaterial({ map: knitTex('#b0353a'), roughness: 1, side: THREE.DoubleSide })));
    g.add(shell(1.14, 0.2, new THREE.MeshStandardMaterial({ map: knitTex('#9a2c31'), roughness: 1, side: THREE.DoubleSide }), th - 0.16));
    const pomPivot = new THREE.Group(); pomPivot.position.y = TOP * 1.08; g.add(pomPivot);
    const pomGeo = new THREE.SphereGeometry(0.19, 24, 16), pp = pomGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) { const k = 1 + (rnd() - 0.5) * 0.18; pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); }
    pomGeo.computeVertexNormals();
    const pom = new THREE.Mesh(pomGeo, std(0xf2efe8, { roughness: 1 })); pom.position.y = 0.16; pomPivot.add(pom);
    const wx = spring(90, 6), wz = spring(90, 6);
    return { obj: g, update(st) { pomPivot.rotation.x = wx.step(st.dt, 0, -st.drot.x * 0.15 + st.kick * 0.3); pomPivot.rotation.z = wz.step(st.dt, 0, -st.drot.z * 0.15 - st.drot.y * 0.05); } };
  } },

  { id: 'propeller', name: '🌀 Propeller Cap', build() {
    const g = new THREE.Group(); const th = eyeTheta - 0.5;
    const cap = shell(1.07, th, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
    const pa = cap.geometry.attributes.position, cols = [], pal = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047].map(c => new THREE.Color(c));
    for (let i = 0; i < pa.count; i++) { const a = Math.atan2(pa.getX(i), pa.getZ(i)); const c = pal[Math.floor((a + Math.PI) / (Math.PI / 2)) % 4]; cols.push(c.r, c.g, c.b); }
    cap.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.add(cap);
    const edge = outerPoint(dirAt(th, Math.PI / 2)).multiplyScalar(1.07);
    const brim = new THREE.Mesh(new THREE.CircleGeometry(0.48, 32, 0, Math.PI), std(0x1e88e5, { side: THREE.DoubleSide }));
    brim.rotation.x = Math.PI / 2 - 0.15; brim.scale.set(1, 0.85, 1); brim.position.set(0, edge.y - 0.02, edge.z - 0.08); g.add(brim);
    const top = TOP * 1.07;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), std(0xdddddd, { metalness: 0.7, roughness: 0.3 })); stem.position.y = top + 0.06; g.add(stem);
    const prop = new THREE.Group(); prop.position.y = top + 0.14; g.add(prop);
    for (const [s, c] of [[1, 0xe53935], [-1, 0xfdd835]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.1), std(c)); b.position.x = s * 0.21; b.rotation.x = s * 0.35; prop.add(b); }
    prop.add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), std(0x43a047)));
    return { obj: g, update(st) { prop.rotation.y += st.dt * (4 + st.jaw * 30 + st.smile * 12); } };
  } },

  { id: 'cowboy', name: '🤠 Cowboy Hat', build() {
    const y = TOP - 0.42, s = (halfWidthAt(y) + 0.07) / 0.66;
    const g = new THREE.Group(); g.position.y = y; g.rotation.x = -0.08; g.scale.set(s, s, s * 0.9);
    const leather = std(0x7a4b28, { roughness: 0.85, side: THREE.DoubleSide });
    const crown = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0.6], [0.35, 0.58], [0.52, 0.52], [0.6, 0.4], [0.63, 0.15], [0.66, 0]].map(([x, yy]) => new THREE.Vector2(x, yy)), 64), leather);
    const cp = crown.geometry.attributes.position;
    for (let i = 0; i < cp.count; i++) { const yy = cp.getY(i); if (yy > 0.45) cp.setY(i, yy - 0.09 * Math.max(0, 1 - Math.abs(cp.getX(i)) / 0.3)); }
    crown.geometry.computeVertexNormals(); g.add(crown);
    const brimGeo = new THREE.RingGeometry(0.6, 1.38, 80, 2); brimGeo.rotateX(-Math.PI / 2);
    const bp = brimGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getZ(i); bp.setY(i, 0.55 * Math.max(0, Math.abs(x) - 0.6) ** 2 - 0.05 * Math.max(0, z) ** 2); }
    brimGeo.computeVertexNormals(); g.add(new THREE.Mesh(brimGeo, leather));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.66, 0.1, 64, 1, true), std(0x2b1a10)); b.position.y = 0.07; g.add(b);
    return { obj: g, update() {} };
  } },

  { id: 'crown', name: '👑 Crown', build() {
    const y = TOP - 0.28, r = halfWidthAt(y) + 0.03;
    const g = new THREE.Group(); g.position.y = y; g.rotation.z = 0.14; g.scale.z = 0.85;
    const au = gold(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r, 0.22, 64, 1, true), au));
    const gems = [0xd81b60, 0x1e88e5, 0x43a047];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, x = Math.sin(a) * r * 1.05, z = Math.cos(a) * r * 1.05;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), au); spike.position.set(x, 0.21, z); g.add(spike);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), au); ball.position.set(x, 0.33, z); g.add(ball);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), std(gems[i % 3], { roughness: 0.1, metalness: 0.2 })); gem.position.set(x * 1.02, 0, z * 1.02); g.add(gem);
    }
    return { obj: g, update() {} };
  } },

  { id: 'chef', name: '👨‍🍳 Chef Hat', build() {
    const g = new THREE.Group(); const white = std(0xfafafa, { roughness: 0.95, side: THREE.DoubleSide });
    const y = TOP - 0.3, r = halfWidthAt(y) + 0.04;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r, 0.32, 64, 1, true), white); b.position.y = y; b.scale.z = 0.85; g.add(b);
    const puff = new THREE.Group(); puff.position.y = y + 0.38; g.add(puff);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), white); s.position.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.26); puff.add(s); }
    const topS = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), white); topS.position.y = 0.12; puff.add(topS);
    const j = spring(120, 6); let pj = 0;
    return { obj: g, update(st) { const x = j.step(st.dt, 0, (st.jaw - pj) * 4 + st.kick * 0.5); pj = st.jaw; puff.scale.set(1 - x * 0.2, 1 + x * 0.4, 1 - x * 0.2); } };
  } },

  { id: 'viking', name: '⚔️ Viking Helmet', build() {
    const g = new THREE.Group(); const th = eyeTheta - 0.35;
    const steel = std(0x8c8f94, { metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }), bronze = std(0xb07a3a, { metalness: 0.9, roughness: 0.3 });
    g.add(shell(1.09, th, steel)); g.add(ring(1.09, th, 0.05, bronze));
    const ridgePts = []; for (let i = 0; i <= 40; i++) ridgePts.push(outerPoint(dirAt(th * (i / 20 - 1), Math.PI / 2)).multiplyScalar(1.1));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ridgePts), 60, 0.04, 8), bronze));
    const ivory = std(0xefe6cf, { roughness: 0.5 });
    for (const sx of [-1, 1]) {
      const p0 = ringPoint(FACE.eyeY + 0.3, sx * Math.PI / 2, 0.05);
      const c = new THREE.QuadraticBezierCurve3(p0, p0.clone().add(new THREE.Vector3(sx * 0.6, 0.15, 0.1)), p0.clone().add(new THREE.Vector3(sx * 0.65, 0.85, 0.25)));
      for (let i = 0, N = 10; i < N; i++) {
        const a = c.getPoint(i / N), b = c.getPoint((i + 1) / N), r0 = 0.16 * (1 - i / N) + 0.02, r1 = 0.16 * (1 - (i + 1) / N) + 0.015;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, a.distanceTo(b) * 1.05, 16), ivory);
        seg.position.copy(a).add(b).multiplyScalar(0.5); seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(seg);
      }
    }
    return { obj: g, update() {} };
  } },

  { id: 'party', name: '🎉 Party Hat', build() {
    const g = new THREE.Group(); g.position.set(0.12, TOP + 0.3, 0); g.rotation.z = -0.28;
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.8, 48, 1, true), new THREE.MeshStandardMaterial({ map: stripeTex(['#ff4fa3', '#ffd400', '#2ec4ff']), roughness: 0.6, side: THREE.DoubleSide })));
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), std(0xffd400, { roughness: 1 })); pom.position.y = 0.43; g.add(pom);
    const w = spring(100, 5);
    return { obj: g, update(st) { g.rotation.z = -0.28 + w.step(st.dt, 0, -st.drot.z * 0.1 + st.kick * 0.2); } };
  } },
];

// ======================= EYEWEAR =======================
const frontZ = y => surfaceAt(0, y, SMOOTH).p.z;
const EYES = [
  { id: 'nvg', name: '🟢 Night Vision Goggles (G)', build() {
    const g = new THREE.Group(); const dark = std(0x24261f, { roughness: 0.5, metalness: 0.35 });
    const my = FACE.eyeY + 0.5, mount = new THREE.Group(); mount.position.set(0, my, frontZ(my) + 0.06); g.add(mount);
    mount.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), dark));
    const dy = FACE.eyeY - my, dz = frontZ(FACE.eyeY) + 0.32 - mount.position.z;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, Math.abs(dy) + 0.05, 0.07), dark); arm.position.set(0, dy / 2, dz * 0.45); arm.rotation.x = -Math.atan2(dz, -dy) * 0.6; mount.add(arm);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.19, 0.2), dark); housing.position.set(0, dy, dz - 0.18); mount.add(housing);
    const lens = new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x39ff6a, emissiveIntensity: 0.2, roughness: 0.1 });
    [-0.26, -0.09, 0.09, 0.26].forEach((x, i) => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.077, 0.3, 24), dark); tube.rotation.x = Math.PI / 2; tube.position.set(x, dy, dz); mount.add(tube);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.066, 24), lens); l.position.set(x, dy, dz + 0.152); mount.add(l);
    });
    let a = -1.25;
    return { obj: g, update(st) { a += ((st.nvgDown ? 0 : -1.25) - a) * Math.min(1, st.dt * 6); mount.rotation.x = a; lens.emissiveIntensity = st.nvgDown ? 1.6 + Math.sin(st.t * 40) * 0.15 : 0.15; } };
  } },

  { id: 'shooters', name: '🕶️ Tactical Shooter Glasses', build() {
    const g = new THREE.Group(); g.position.y = FACE.eyeY;
    const rx = halfWidthAt(FACE.eyeY) + 0.1, rz = frontZ(FACE.eyeY) + 0.1;
    const lensGeo = new THREE.CylinderGeometry(1, 1, 0.2, 64, 1, true, -0.85, 1.7); lensGeo.scale(rx, 1, rz);
    const lensM = new THREE.Mesh(lensGeo, new THREE.MeshPhysicalMaterial({ color: 0xffa630, transparent: true, opacity: 0.5, roughness: 0.04, metalness: 0.3, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })); lensM.renderOrder = 4; g.add(lensM);
    const frameGeo = new THREE.CylinderGeometry(1, 1, 0.035, 64, 1, true, -0.87, 1.74); frameGeo.scale(rx + 0.005, 1, rz + 0.005);
    const frame = new THREE.Mesh(frameGeo, std(0x151515, { side: THREE.DoubleSide })); frame.position.y = 0.11; g.add(frame);
    for (const sx of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.6), std(0x151515)); t.position.set(sx * rx * 0.97, 0.1, -0.1); g.add(t); }
    return { obj: g, update() {} };
  } },

  { id: 'aviators', name: '😎 Aviator Sunglasses', build() {
    const g = new THREE.Group(); const au = gold();
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x1f3326, transparent: true, opacity: 0.88, roughness: 0.05, metalness: 0.4, clearcoat: 1, depthWrite: false });
    for (const x of [-FACE.eyeX, FACE.eyeX]) {
      const holder = onFace(new THREE.Group(), x, FACE.eyeY, 0.09); g.add(holder);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.18, 40), lensMat); l.scale.set(1.1, 0.95, 1); l.renderOrder = 4; holder.add(l);
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.011, 8, 40), au); f.scale.set(1.1, 0.95, 1); holder.add(f);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.75, 8), au); arm.rotation.x = Math.PI / 2; arm.position.set(x > 0 ? 0.2 : -0.2, 0.05, -0.38); holder.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), au); bridge.rotation.z = Math.PI / 2; onFace(bridge, 0, FACE.eyeY + 0.11, 0.08); g.add(bridge);
    return { obj: g, update() {} };
  } },
];

// ======================= EARS =======================
function headset(style) {
  const tactical = style === 'tactical';
  const g = new THREE.Group();
  const shellM = std(tactical ? 0x8b7653 : 0x18181c, { roughness: tactical ? 0.8 : 0.4, metalness: tactical ? 0 : 0.2 });
  const cy = 0.3, cx = halfWidthAt(cy) + 0.09, rgb = [];
  for (const sx of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.17, 32), shellM); cup.rotation.z = Math.PI / 2; cup.position.set(sx * cx, cy, -0.02); g.add(cup);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.06, 32), std(tactical ? 0x5f5240 : 0x26262c)); cap.rotation.z = Math.PI / 2; cap.position.set(sx * (cx + 0.1), cy, -0.02); g.add(cap);
    if (!tactical) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 40), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff00ff, emissiveIntensity: 2 })); r.rotation.y = Math.PI / 2; r.position.set(sx * (cx + 0.095), cy, -0.02); g.add(r); rgb.push({ r, sx }); }
  }
  const b = new THREE.Mesh(new THREE.TorusGeometry(cx, 0.045, 10, 56, Math.PI), shellM); b.position.y = cy; b.scale.y = (TOP + 0.09 - cy) / cx; g.add(b);
  const mz = frontZ(FACE.mouthY);
  const curve = new THREE.CatmullRomCurve3([[-cx - 0.04, 0.2, 0.1], [-cx + 0.05, -0.08, 0.45], [-0.55, FACE.mouthY - 0.12, mz - 0.05], [-0.32, FACE.mouthY - 0.08, mz + 0.06]].map(p => new THREE.Vector3(...p)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.02, 8), std(0x111111)));
  const foam = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), std(0x111111, { roughness: 1 })); foam.position.copy(curve.getPoint(1)); g.add(foam);
  return { obj: g, update(st) { for (const { r, sx } of rgb) r.material.emissive.setHSL((st.t * 0.15 + (sx > 0 ? 0.5 : 0)) % 1, 1, 0.5); } };
}
const EARS = [
  { id: 'comtac', name: '🎧 Tactical Ear Pro Headset', build: () => headset('tactical') },
  { id: 'gaming', name: '🎮 RGB Gaming Headset', build: () => headset('gaming') },
];

// ======================= BODY (moves with the waist) =======================
const BODY = [
  { id: 'foil', name: '✨ Foil Wrap', build() {
    return { obj: band(-1.4, -0.5, 0.06, std(0xdde2e8, { metalness: 1, roughness: 0.32, side: THREE.DoubleSide, envMapIntensity: 1.4 }), true), update() {} };
  } },
  { id: 'platecarrier', name: '🦺 Plate Carrier', build() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ map: camoTex('#7b7356', ['#5f6b45', '#9a8a62', '#4a4232', '#c2b48a']), roughness: 1, side: THREE.DoubleSide });
    g.add(band(-1.22, -0.42, 0.09, cloth));
    const zf = ringPoint(-0.78, 0, 0.09).z;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.72, 0.12), cloth); plate.position.set(0, -0.78, zf + 0.04); g.add(plate);
    for (const x of [-0.26, 0, 0.26]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.3, 0.14), std(0x6b6248, { roughness: 1 })); p.position.set(x, -0.98, zf + 0.16); g.add(p);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.15), std(0x564e3a)); flap.position.set(x, -0.82, zf + 0.16); g.add(flap);
    }
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshStandardMaterial({ map: patchTex('TATER', '#2f3326', '#e0d29a'), roughness: 0.95 }));
    patch.position.set(0, -0.56, zf + 0.105); g.add(patch);
    return { obj: g, update() {} };
  } },
  { id: 'chain', name: '⛓️ Gold Chain', build() {
    const g = new THREE.Group(); const au = gold(); const N = 52;
    const pos = a => { const fr = Math.max(0, Math.cos(a)); return ringPoint(-0.4 - 0.3 * fr * fr, a, 0.045); };
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, p = pos(a), q = pos(a + 0.01);
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.014, 6, 14), au);
      link.position.copy(p); link.lookAt(q); link.rotateY(Math.PI / 2); if (i % 2) link.rotateX(Math.PI / 2); g.add(link);
    }
    const med = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 40), [au, new THREE.MeshStandardMaterial({ map: patchTex('T', '#e6b94a', '#6b4d10'), metalness: 0.9, roughness: 0.3 }), au]);
    const mp = pos(0); const piv = new THREE.Group(); piv.position.copy(mp); g.add(piv);
    med.rotation.x = Math.PI / 2; med.position.set(0, -0.16, 0.05); piv.add(med);
    const sw = spring(60, 4);
    return { obj: g, update(st) { piv.rotation.z = sw.step(st.dt, 0, -st.drot.y * 0.05 + st.kick * 0.2); } };
  } },
  { id: 'bowtie', name: '🎀 Bow Tie', build() {
    const g = new THREE.Group(); const red = std(0xc0182c, { roughness: 0.45 });
    const holder = onFace(new THREE.Group(), 0, -0.52, 0.05); g.add(holder);
    holder.add(new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), red));
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4), red); w.rotation.z = s * Math.PI / 2; w.position.x = s * 0.16; w.scale.set(1, 1, 0.45); holder.add(w); }
    let pj = 0; const j = spring(150, 8);
    return { obj: g, update(st) { const x = j.step(st.dt, 0, (st.jaw - pj) * 3); pj = st.jaw; holder.scale.set(1 + x * 0.3, 1 - x * 0.2, 1); } };
  } },
  { id: 'scarf', name: '🧣 Scarf', build() {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ map: stripeTex(['#2e5aa8', '#e9e2d0'], 6), roughness: 1 });
    const y = -0.48; g.add(loop(y, 0.1, 0.13, mat));
    const tp = ringPoint(y - 0.05, 0.45, 0.16);
    const tailPivot = new THREE.Group(); tailPivot.position.copy(tp); g.add(tailPivot);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.07), mat); tail.position.y = -0.34; tailPivot.add(tail);
    const sw = spring(40, 3);
    return { obj: g, update(st) { tailPivot.rotation.z = 0.1 + sw.step(st.dt, 0, -st.drot.z * 0.2 - st.drot.y * 0.08 + st.kick * 0.3); } };
  } },
];


// ======================= MILITARY & NEW ITEMS =======================
const thetaAt = y => Math.acos(Math.max(-1, Math.min(1, y / TOP)));
// a cap whose lower edge can sit at a different height all the way round (deeper at the sides/back)
function cap(k, thetaOfPhi, mat, segU = 96, segV = 36) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= segV; j++) for (let i = 0; i <= segU; i++) {
    const phi = i / segU * TAU, th = thetaOfPhi(phi) * j / segV;
    const p = outerPoint(dirAt(th, phi)).multiplyScalar(k); pos.push(p.x, p.y, p.z); uv.push(i / segU * 3, j / segV * 1.5);
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) { const a = j * (segU + 1) + i, b = a + segU + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function capEdge(k, thetaOfPhi, tube, mat) {
  const pts = []; for (let i = 0; i < 128; i++) { const phi = i / 128 * TAU; pts.push(outerPoint(dirAt(thetaOfPhi(phi), phi)).multiplyScalar(k)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, tube, 8, true), mat);
}
// phi = PI/2 is the front of the face, 3PI/2 the back
const frontness = phi => Math.max(0, Math.sin(phi));
const multicamTex = () => camoTex('#9b8a64', ['#6f6a44', '#b9a77d', '#5b4a32', '#7d8455', '#d0c39c', '#3d3424']);
const woodlandTex = () => camoTex('#56603f', ['#2b2a20', '#7a6440', '#3d4a2a', '#1f241a']);
const checkTex = (a, b) => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) g.fillRect(i * 16 + 4, j * 16 + 4, 8, 8);
  for (let i = 0; i < 8; i++) { g.fillRect(i * 16, 0, 2, h); g.fillRect(0, i * 16, w, 2); }
}, [8, 4]);
const eyeDir = sx => surfaceAt(sx * FACE.eyeX, FACE.eyeY, SMOOTH).d;
function surfaceRing(cx, cy, rx, ry, off, tube, mat, n = 48) {   // a loop drawn on the face (lens frames, mask edges)
  const pts = []; for (let i = 0; i < n; i++) { const a = i / n * TAU, s = surfaceAt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, SMOOTH); pts.push(s.p.addScaledVector(s.n, off)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), n * 3, tube, 8, true), mat);
}
function surfacePatch(x0, x1, y0, y1, off, mat, keep = () => true, nu = 40, nv = 30) {   // a sheet laid over the face
  const pos = [], idx = [], uv = [], grid = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const x = x0 + (x1 - x0) * i / nu, y = y0 + (y1 - y0) * j / nv, s = surfaceAt(x, y, SMOOTH);
    const p = s.p.addScaledVector(s.n, off); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv); grid.push([x, y]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + nu + 1, [cx, cy] = grid[a];
    if (!keep(cx + (x1 - x0) / nu / 2, cy + (y1 - y0) / nv / 2)) continue;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function akMag(mat) {   // curved AK magazine
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.045), mat); b.position.set(i * i * 0.006, -i * 0.08, 0); b.rotation.z = i * 0.09; g.add(b); }
  return g;
}

const MIL_HEAD = [
  { id: 'fishbowl', name: '🐠 Fishbowl Helmet (upside down)', build() {
    const g = new THREE.Group(), bowl = new THREE.Group(); g.add(bowl);
    const R = 1.42, cy = 0.2, yOpen = FACE.mouthY - 0.5, rb = 0.6, yTop = cy + Math.sqrt(R * R - rb * rb);
    const prof = (off) => { const pts = []; for (let i = 0; i <= 48; i++) { const y = yOpen + (yTop - yOpen) * i / 48; pts.push(new THREE.Vector2(Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)) + off, y)); } return pts; };
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xf2fbf8, transparent: true, opacity: 0.14, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, envMapIntensity: 3, side: THREE.DoubleSide, depthWrite: false });
    const outer = new THREE.Mesh(new THREE.LatheGeometry(prof(0), 96), glassMat); outer.renderOrder = 6; bowl.add(outer);
    const inner = new THREE.Mesh(new THREE.LatheGeometry(prof(-0.03), 96), glassMat.clone()); inner.material.opacity = 0.06; inner.renderOrder = 6; bowl.add(inner);
    const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xa8d8c8, transparent: true, opacity: 0.45, roughness: 0.05, clearcoat: 1, envMapIntensity: 2, depthWrite: false });
    const rOpen = Math.sqrt(R * R - (yOpen - cy) ** 2);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rOpen + 0.03, 0.035, 14, 96), edgeMat); lip.rotation.x = Math.PI / 2; lip.position.y = yOpen; lip.renderOrder = 7; bowl.add(lip);
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(rb, 0.04, 12, 72), edgeMat); baseRing.rotation.x = Math.PI / 2; baseRing.position.y = yTop; baseRing.renderOrder = 7; bowl.add(baseRing);
    const base = new THREE.Mesh(new THREE.CircleGeometry(rb, 64), edgeMat.clone()); base.material.opacity = 0.22; base.rotation.x = -Math.PI / 2; base.position.y = yTop; base.renderOrder = 7; bowl.add(base);
    // breath fog on the inside of the glass in front of the mouth
    const fogTex = canvasTex(128, 128, (c, w, h) => { const gr = c.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const fz = Math.sqrt(R * R - (FACE.mouthY - cy) ** 2) - 0.045;
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: 0, depthWrite: false }));
    fog.position.set(0, FACE.mouthY - 0.02, fz); fog.renderOrder = 8; bowl.add(fog);
    // a few water drops left inside, sliding down
    const dropMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 0, clearcoat: 1, envMapIntensity: 3 });
    const drops = Array.from({ length: 7 }, (_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), dropMat); m.scale.set(1, 1.4, 0.5); m.userData = { a: Math.PI / 2 + (i - 3) * 0.32, y: yTop - 0.2 - i * 0.13, v: 0 }; m.renderOrder = 7; bowl.add(m); return m; });
    const wob = { x: spring(70, 5), z: spring(70, 5) }; let fogLevel = 0;
    return { obj: g, update(st) {
      bowl.rotation.x = wob.x.step(st.dt, 0, -st.drot.x * 0.06 + st.kick * 0.2);
      bowl.rotation.z = wob.z.step(st.dt, 0, -st.drot.z * 0.06 - st.drot.y * 0.02);
      fogLevel += ((st.jaw > 0.15 ? 0.75 : 0) - fogLevel) * Math.min(1, st.dt * (st.jaw > 0.15 ? 1.6 : 0.35));
      fog.material.opacity = fogLevel; fog.scale.setScalar(0.8 + fogLevel * 0.5);
      for (const m of drops) {
        const u = m.userData; u.v += (Math.random() < 0.004 ? 0.25 : 0) - u.v * st.dt * 1.5; u.y -= u.v * st.dt;
        if (u.y < yOpen + 0.05) { u.y = yTop - 0.15; u.v = 0; }
        const r = Math.sqrt(Math.max(0, R * R - (u.y - cy) ** 2)) - 0.035; m.position.set(Math.cos(u.a) * r * -1 * 0 + Math.sin(u.a - Math.PI / 2) * r, u.y, Math.cos(u.a - Math.PI / 2) * r);
      }
    } };
  } },

  { id: 'pasgt', name: '🪖 PASGT Helmet + Goggles', build() {
    const g = new THREE.Group();
    const camo = new THREE.MeshStandardMaterial({ map: woodlandTex(), roughness: 0.95, side: THREE.DoubleSide });
    const edge = phi => eyeTheta - 0.2 + 0.55 * (1 - frontness(phi)) * (Math.sin(phi) < 0 ? 0.8 : 1);
    g.add(cap(1.1, edge, camo)); g.add(capEdge(1.1, edge, 0.035, std(0x3a3f2a, { roughness: 0.9 })));
    g.add(ring(1.12, eyeTheta * 0.62, 0.03, std(0x2b2b22, { roughness: 0.9 })));
    // goggles resting on the band
    const strapMat = std(0x1c1c18, { roughness: 0.9 }), lensMat = new THREE.MeshPhysicalMaterial({ color: 0xd8c27a, transparent: true, opacity: 0.55, roughness: 0.05, clearcoat: 1, metalness: 0.3, depthWrite: false });
    for (const sx of [-1, 1]) {
      const p = placeOn(new THREE.Group(), 1.13, [sx * 0.33, 0.78, 0.6], 0.03); g.add(p);
      const fr = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 10, 32), strapMat); fr.scale.set(1.25, 0.9, 1); p.add(fr);
      const ln = new THREE.Mesh(new THREE.CircleGeometry(0.125, 32), lensMat); ln.scale.set(1.25, 0.9, 1); ln.position.z = 0.01; p.add(ln);
    }
    return { obj: g, update() {} };
  } },

  { id: 'boonie', name: '🎩 Boonie Hat (multicam)', build() {
    const g = new THREE.Group(); const cloth = new THREE.MeshStandardMaterial({ map: multicamTex(), roughness: 1, side: THREE.DoubleSide });
    const th = eyeTheta - 0.42; g.add(shell(1.07, th, cloth));
    const pos = [], idx = [], uv = [], U = 96, Vn = 6;
    for (let j = 0; j <= Vn; j++) for (let i = 0; i <= U; i++) {
      const phi = i / U * TAU, t = j / Vn, e = outerPoint(dirAt(th, phi)).multiplyScalar(1.07);
      const hz = Math.hypot(e.x, e.z) || 1, out = 0.42 * t, droop = -0.18 * t * t * (0.7 + 0.3 * Math.sin(phi * 3 + 1));
      pos.push(e.x + e.x / hz * out, e.y + droop, e.z + e.z / hz * out); uv.push(i / U * 4, t);
    }
    for (let j = 0; j < Vn; j++) for (let i = 0; i < U; i++) { const a = j * (U + 1) + i, b = a + U + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx); bg.computeVertexNormals();
    const brim = new THREE.Mesh(bg, cloth); g.add(brim);
    g.add(ring(1.08, th - 0.08, 0.03, std(0x5b5038, { roughness: 1 })));
    const flap = spring(50, 4);
    return { obj: g, update(st) { const x = flap.step(st.dt, 0, -st.drot.x * 0.05 + st.kick * 0.3); brim.scale.y = 1 + x * 0.6; } };
  } },

  { id: 'beret', name: '🟩 Green Beret', build() {
    const g = new THREE.Group(); g.position.set(0.05, TOP - 0.12, 0.02); g.rotation.z = 0.32; g.rotation.x = -0.12;
    const felt = std(0x2f4a2a, { roughness: 1 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 20), felt); top.scale.set(1.05, 0.32, 0.95); top.position.set(-0.08, 0.1, 0); g.add(top);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 10, 48), std(0x1b1b14, { roughness: 0.8 })); band.rotation.x = Math.PI / 2; band.scale.set(1.08, 0.92, 1); g.add(band);
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.02), std(0x2a3a7a)); flash.position.set(0.32, 0.06, 0.42); flash.rotation.y = 0.6; g.add(flash);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), gold()); badge.rotation.x = Math.PI / 2; badge.position.set(0.33, 0.07, 0.435); badge.rotation.z = 0.6; g.add(badge);
    return { obj: g, update() {} };
  } },

  { id: 'ghillie', name: '🌿 Ghillie Hood', build() {
    const g = new THREE.Group(); const mats = [0x4b5a2c, 0x6b6a3a, 0x3a3d22, 0x7d6b45, 0x56602f].map(c => std(c, { roughness: 1 }));
    const groups = Array.from({ length: 6 }, () => { const p = new THREE.Group(); g.add(p); return p; });
    const lim = phi => eyeTheta - 0.25 + 0.9 * (1 - frontness(phi));
    for (let i = 0; i < 340; i++) {
      const phi = rnd() * TAU, th = rnd() ** 0.8 * lim(phi), d = dirAt(th, phi), p = outerPoint(d).multiplyScalar(1.03);
      const n = shapeNormal(d, SMOOTH), len = 0.22 + rnd() * 0.32;
      const strand = new THREE.Mesh(new THREE.ConeGeometry(0.03 + rnd() * 0.025, len, 4), mats[i % mats.length]);
      const dir = n.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
      strand.position.copy(p).addScaledVector(dir, len * 0.45); strand.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      strand.rotateY(rnd() * 3); strand.scale.x = 0.6; groups[i % 6].add(strand);
    }
    const sw = groups.map(() => spring(30 + rnd() * 20, 3));
    return { obj: g, update(st) { groups.forEach((p, i) => { p.rotation.z = sw[i].step(st.dt, 0, -st.drot.z * 0.004 - st.drot.y * 0.002 + Math.sin(st.t * 2 + i) * 0.0008); }); } };
  } },
];

const MIL_FACE = [
  { id: 'gasmask', name: '😷 Gas Mask', build() {
    const g = new THREE.Group(); const rubber = std(0x26282a, { roughness: 0.55, side: THREE.DoubleSide });
    const ex = FACE.eyeX, ey = FACE.eyeY, lr = 0.17;
    const xs = halfWidthAt(FACE.eyeY) * 0.9, y0 = FACE.mouthY - 0.42, y1 = ey + 0.27, ymid = (y0 + y1) / 2, ry = (y1 - y0) / 2;
    const outline = (x, y) => { const t = (y - ymid) / ry; const half = xs * (t > 0 ? Math.sqrt(Math.max(0, 1 - t ** 4)) : Math.sqrt(Math.max(0, 1 - t * t)) * (0.55 + 0.45 * (1 + t))); return Math.abs(x) < half; };
    const keep = (x, y) => outline(x, y) && Math.hypot((x - ex) / lr, (y - ey) / lr) > 1 && Math.hypot((x + ex) / lr, (y - ey) / lr) > 1;
    g.add(surfacePatch(-xs, xs, y0, y1, 0.05, rubber, keep, 60, 44));
    const ringMat = std(0x55585c, { metalness: 0.7, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe0e0, transparent: true, opacity: 0.18, roughness: 0, clearcoat: 1, envMapIntensity: 2.5, depthWrite: false });
    for (const sx of [-1, 1]) {
      g.add(surfaceRing(sx * ex, ey, lr, lr, 0.075, 0.03, ringMat));
      const s = surfaceAt(sx * ex, ey, SMOOTH); const l = new THREE.Mesh(new THREE.CircleGeometry(lr, 32), glass);
      l.position.copy(s.p).addScaledVector(s.n, 0.09); l.quaternion.setFromUnitVectors(Z, s.n); l.renderOrder = 6; g.add(l);
    }
    const ms = surfaceAt(0, FACE.mouthY - 0.05, SMOOTH);
    const snout = new THREE.Group(); snout.position.copy(ms.p).addScaledVector(ms.n, 0.08); snout.quaternion.setFromUnitVectors(Z, ms.n); g.add(snout);
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.14, 24), rubber); port.rotation.x = Math.PI / 2; port.position.z = 0.06; snout.add(port);
    const can = new THREE.Group(); can.position.set(-0.05, -0.12, 0.12); can.rotation.set(-0.5, 0, 0.5); snout.add(can);
    const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.24, 28), std(0x4c5a3a, { roughness: 0.6, metalness: 0.3 })); canister.rotation.x = Math.PI / 2; canister.position.z = 0.12; can.add(canister);
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.008, 6, 28), ringMat); r.position.z = 0.04 + i * 0.08; can.add(r); }
    // straps round the back of the head
    g.add(loop(FACE.eyeY + 0.1, 0.06, 0.025, rubber)); g.add(loop(FACE.mouthY - 0.15, 0.06, 0.025, rubber));
    let pj = 0; const j = spring(140, 8);
    return { obj: g, update(st) { const x = j.step(st.dt, 0, (st.jaw - pj) * 3); pj = st.jaw; can.position.z = 0.12 + x * 0.04; } };
  } },
];

const MIL_EYES = [
  { id: 'goggles', name: '🥽 Ballistic Goggles', build() {
    const g = new THREE.Group();
    const frame = std(0x2c2a24, { roughness: 0.7 }), lens = new THREE.MeshPhysicalMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, roughness: 0.02, clearcoat: 1, metalness: 0.2, envMapIntensity: 2, depthWrite: false });
    const w = FACE.eyeX + 0.24, y0 = FACE.eyeY - 0.17, y1 = FACE.eyeY + 0.17;
    const l = surfacePatch(-w, w, y0, y1, 0.09, lens); l.renderOrder = 6; g.add(l);
    const pts = []; for (let i = 0; i < 64; i++) { const a = i / 64 * TAU, x = Math.cos(a) * w, y = FACE.eyeY + Math.sin(a) * 0.17 * (1 - 0.25 * Math.max(0, Math.cos(a * 2 + Math.PI)) * (Math.sin(a) < 0 ? 1 : 0)); const s = surfaceAt(x * 0.99, y, SMOOTH); pts.push(s.p.addScaledVector(s.n, 0.09)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.035, 8, true), frame));
    g.add(loop(FACE.eyeY + 0.02, 0.07, 0.03, std(0x4a4436, { roughness: 1 })));
    return { obj: g, update() {} };
  } },
  { id: 'pvs14', name: '🔭 PVS-14 Monocular (G)', build() {
    const g = new THREE.Group(); const dark = std(0x23251f, { roughness: 0.5, metalness: 0.35 });
    g.add(ring(1.11, eyeTheta * 0.55, 0.035, std(0x1d1d18, { roughness: 0.9 })));
    const my = FACE.eyeY + 0.55, mount = new THREE.Group(); mount.position.set(0, my, frontZ(my) + 0.05); g.add(mount);
    mount.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), dark));
    const x = FACE.eyeX, dy = FACE.eyeY - my, dz = frontZ(FACE.eyeY) + 0.3 - mount.position.z;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), dark); arm.position.set(x / 2, dy * 0.5, dz * 0.4); arm.rotation.z = Math.atan2(dy * 0.5, x); mount.add(arm);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.42, 28), dark); tube.rotation.x = Math.PI / 2; tube.position.set(x, dy, dz); mount.add(tube);
    const eyecup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.08, 28), std(0x111111, { roughness: 0.9 })); eyecup.rotation.x = Math.PI / 2; eyecup.position.set(x, dy, dz - 0.24); mount.add(eyecup);
    const lens = new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x39ff6a, emissiveIntensity: 0.2, roughness: 0.1 });
    const ln = new THREE.Mesh(new THREE.CircleGeometry(0.08, 28), lens); ln.position.set(x, dy, dz + 0.212); mount.add(ln);
    let a = -1.25;
    return { obj: g, update(st) { a += ((st.nvgDown ? 0 : -1.25) - a) * Math.min(1, st.dt * 6); mount.rotation.x = a; lens.emissiveIntensity = st.nvgDown ? 1.6 + Math.sin(st.t * 40) * 0.15 : 0.15; } };
  } },
];

const MIL_BODY = [
  { id: 'chestrig', name: '🎽 AK Chest Rig', build() {
    const g = new THREE.Group(); const cloth = new THREE.MeshStandardMaterial({ map: woodlandTex(), roughness: 1 });
    const strap = std(0x3b3a2a, { roughness: 1 });
    const y = -0.78, zf = ringPoint(y, 0, 0.07).z;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.42, 0.14), cloth); panel.position.set(0, y, zf + 0.03); g.add(panel);
    const magMat = std(0x3a2a1c, { roughness: 0.5, metalness: 0.15 });
    for (let i = 0; i < 4; i++) {
      const x = -0.33 + i * 0.22;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.12), cloth); p.position.set(x, y - 0.02, zf + 0.14); g.add(p);
      const m = akMag(magMat); m.position.set(x - 0.01, y + 0.2, zf + 0.14); m.rotation.z = Math.PI; m.scale.set(0.9, 0.55, 0.9); g.add(m);
    }
    g.add(loop(y + 0.12, 0.07, 0.035, strap));
    for (const sx of [-1, 1]) {   // shoulder straps up the sides
      const pts = [ringPoint(y + 0.15, sx * 0.5, 0.07), ringPoint(-0.3, sx * 0.9, 0.06), ringPoint(-0.05, sx * 1.6, 0.05), ringPoint(y + 0.12, sx * 2.6, 0.07)];
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.04, 6), strap));
    }
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshStandardMaterial({ map: patchTex('MGAS', '#3d4a2a', '#e8dcb0'), roughness: 0.9 }));
    flag.position.set(0, y + 0.1, zf + 0.105); g.add(flag);
    return { obj: g, update() {} };
  } },
  { id: 'bandolier', name: '🧨 Shotgun Shell Bandolier', build() {
    const g = new THREE.Group(); const leather = std(0x5a3a20, { roughness: 0.8 });
    const path = a => ringPoint(-0.75 + 0.3 * Math.sin(a + 0.6), a, 0.07);
    const pts = []; for (let i = 0; i < 64; i++) pts.push(path(i / 64 * TAU));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.05, 8, true), leather));
    const red = std(0xa11b1b, { roughness: 0.5 }), brass = std(0xd8b04a, { metalness: 1, roughness: 0.3 });
    for (let i = 0; i < 13; i++) {
      const a = -0.9 + i * 0.15 + Math.PI / 2 - Math.PI / 2, p = path(a + 0.3), q = path(a + 0.31);
      const shell = new THREE.Group(); shell.position.copy(p); const out = new THREE.Vector3(p.x, 0, p.z).normalize(); shell.position.addScaledVector(out, 0.04);
      shell.lookAt(shell.position.clone().add(out)); g.add(shell);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), red); shell.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.04, 12), brass); cap.position.y = -0.08; shell.add(cap);
    }
    return { obj: g, update() {} };
  } },
];
const MIL_NECK = [
  { id: 'dogtags', name: '🏷️ Dog Tags', build() {
    const g = new THREE.Group(); const steel = std(0xc8ccd2, { metalness: 1, roughness: 0.3 });
    const pos = a => { const fr = Math.max(0, Math.cos(a)); return ringPoint(-0.42 - 0.22 * fr * fr, a, 0.04); };
    const pts = []; for (let i = 0; i < 64; i++) pts.push(pos(i / 64 * TAU));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.008, 6, true), steel));
    const piv = new THREE.Group(); piv.position.copy(pos(0)); g.add(piv);
    const tags = [];
    for (const [dx, rz] of [[-0.02, 0.1], [0.03, -0.12]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.01), steel); t.position.set(dx, -0.1, 0.02); t.rotation.z = rz; piv.add(t); tags.push(t);
    }
    const sw = spring(50, 3), sw2 = spring(60, 3);
    return { obj: g, update(st) { piv.rotation.z = sw.step(st.dt, 0, -st.drot.y * 0.05 - st.drot.z * 0.06 + st.kick * 0.3); tags[1].rotation.z = -0.12 + sw2.step(st.dt, 0, st.kick * 0.4 - st.drot.z * 0.04); } };
  } },
  { id: 'shemagh', name: '🧣 Shemagh', build() {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ map: checkTex('#c9b88e', '#2b2620'), roughness: 1 });
    g.add(band(-0.62, -0.32, 0.1, mat));
    g.add(loop(-0.36, 0.12, 0.08, mat));
    const tp = ringPoint(-0.5, -0.5, 0.18), piv = new THREE.Group(); piv.position.copy(tp); g.add(piv);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 3), mat); tail.position.y = -0.27; tail.rotation.y = 0.5; piv.add(tail);
    const sw = spring(40, 3);
    return { obj: g, update(st) { piv.rotation.z = -0.1 + sw.step(st.dt, 0, -st.drot.z * 0.2 - st.drot.y * 0.08 + st.kick * 0.3); } };
  } },
];
const MIL_BACK = [
  { id: 'radio', name: '📻 Radio Pack + Antenna', build() {
    const g = new THREE.Group(); const y = -0.6, zb = ringPoint(y, Math.PI, 0.05).z;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.3), std(0x4c513a, { roughness: 0.9 })); pack.position.set(0.05, y, zb - 0.15); g.add(pack);
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.12), std(0x2a2c26, { roughness: 0.6, metalness: 0.2 })); radio.position.set(0.05, y + 0.2, zb - 0.32); g.add(radio);
    const ant = new THREE.Group(); ant.position.set(0.25, y + 0.34, zb - 0.28); g.add(ant);
    const segs = []; let prev = ant;
    for (let i = 0; i < 6; i++) { const s = new THREE.Group(); s.position.y = i ? 0.22 : 0; const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012 - i * 0.0012, 0.013 - i * 0.0012, 0.22, 6), std(0x111111)); rod.position.y = 0.11; s.add(rod); prev.add(s); prev = s; segs.push(s); }
    g.add(loop(y + 0.15, 0.06, 0.035, std(0x2d2f22, { roughness: 1 })));
    const sx = spring(25, 2.5), sz = spring(25, 2.5);
    return { obj: g, update(st) {
      const bx = sx.step(st.dt, 0, -st.drot.x * 0.08 + st.kick * 0.4), bz = sz.step(st.dt, 0, -st.drot.z * 0.08 - st.drot.y * 0.04);
      segs.forEach((s, i) => { s.rotation.x = bx * 0.25 * (i + 1) / 3; s.rotation.z = bz * 0.25 * (i + 1) / 3 + Math.sin(st.t * 3 + i) * 0.01; });
    } };
  } },
];


// ======================= HAIR: beards, mustaches, mullets =======================
// Thousands of tapered, curved strands drawn as one instanced mesh per region.
function strandGeometry(bend = 0.35, sides = 4, rings = 7) {
  const pos = [], idx = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1), y = t, z = bend * t * t, rad = 0.5 * (1 - t * 0.92);
    for (let s = 0; s < sides; s++) { const a = s / sides * TAU; pos.push(Math.cos(a) * rad, y, z + Math.sin(a) * rad * 0.6); }
  }
  for (let r = 0; r < rings - 1; r++) for (let s = 0; s < sides; s++) {
    const a = r * sides + s, b = r * sides + (s + 1) % sides, c = a + sides, d = b + sides; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3(), _basis = new THREE.Matrix4();
// strands: [{p, dir, len, w, color, droop?}] -> InstancedMesh
function strandMesh(strands, bend = 0.35) {
  const mesh = new THREE.InstancedMesh(strandGeometry(bend), new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0, envMapIntensity: 0.5 }), strands.length);
  const col = new THREE.Color();
  strands.forEach((h, i) => {
    const y = h.dir.clone().normalize(); const down = h.droop || new THREE.Vector3(0, -1, 0);
    _z.copy(down).addScaledVector(y, -down.dot(y)); if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1); _z.normalize(); _x.crossVectors(y, _z).normalize();
    _basis.makeBasis(_x, y, _z); _q.setFromRotationMatrix(_basis); _s.set(h.w, h.len, h.w);
    _m.compose(h.p, _q, _s); mesh.setMatrixAt(i, _m);
    col.set(h.color); col.offsetHSL(0, 0, (rnd() - 0.5) * 0.08); mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
// a thin hair-colored layer under the strands so no skin shows through
function hairBase(accept, color, k = 1.012) {
  const geo = new THREE.SphereGeometry(1, 180, 130), pa = geo.attributes.position, d = new THREE.Vector3(), keepV = [];
  for (let i = 0; i < pa.count; i++) {
    d.fromBufferAttribute(pa, i).normalize(); const p = outerPoint(d); const az = Math.atan2(p.x, p.z);
    keepV.push(!!accept(p, az)); p.multiplyScalar(k); pa.setXYZ(i, p.x, p.y, p.z);
  }
  const old = geo.index.array, idx = [];
  for (let i = 0; i < old.length; i += 3) if (keepV[old[i]] && keepV[old[i + 1]] && keepV[old[i + 2]]) idx.push(old[i], old[i + 1], old[i + 2]);
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, std(new THREE.Color(color).multiplyScalar(0.8), { roughness: 0.95 }));
}
const HAIR = {
  brown: ['#3b2616', '#4a3020', '#2e1d10', '#5a3b24'], black: ['#141110', '#1d1915', '#0c0a09', '#2a2420'],
  blonde: ['#c9a45c', '#d8b977', '#b48d48', '#e2c88d'], ginger: ['#a5481c', '#b8582a', '#8c3a14', '#c86a35'],
  grey: ['#9a9590', '#b5b0aa', '#7a7672', '#cfcac4'], dirty: ['#8a6a3c', '#a07d48', '#6f5230', '#b8955c']
};
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const MOUTH = { rx: 0.24, ry: 0.14 };
const inMouth = (x, y) => ((x / MOUTH.rx) ** 2 + ((y - FACE.mouthY) / MOUTH.ry) ** 2) < 1;
// random points on the head with their outward normal
function scatter(n, accept) {
  const out = []; let tries = 0;
  while (out.length < n && tries++ < n * 60) {
    const u = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - u * u), d = new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
    const p = outerPoint(d); const az = Math.atan2(p.x, p.z);   // 0 = front, +-PI = back
    const res = accept(p, az, d); if (!res) continue;
    out.push({ p, d, az, n: shapeNormal(d, SMOOTH), ...res });
  }
  return out;
}
// facial hair that sits on the face: shape(x, y) says if a point belongs and how long the hair is there
function facialHair({ count, shape, palette, outward = 0.12, spread = 0.3, w = 0.014, droop = 0.4 }) {
  count = Math.round(count * 2.6);
  const pts = scatter(count, (p, az) => { if (p.z < -0.35) return null; const len = shape(p.x, p.y, az); return len > 0 ? { len } : null; });
  const strands = pts.map(({ p, n, len }) => {
    const side = Math.sign(p.x) * Math.min(1, Math.abs(p.x) / 0.5);
    const dir = new THREE.Vector3(side * spread, -1, 0).addScaledVector(n, outward).normalize();
    return { p: p.clone().addScaledVector(n, 0.006), dir, len: len * (0.75 + rnd() * 0.5), w: w * (0.7 + rnd() * 0.6), color: pick(palette), droop: n.clone() };
  });
  const g = new THREE.Group();
  g.add(hairBase((p, az) => p.z > -0.35 && shape(p.x, p.y, az) > 0, palette[0]));
  g.add(strandMesh(strands, droop));
  return g;
}
const jag = (x, y, amt = 0.035) => (vnoise(x * 14 + 3, y * 14, 1.7) - 0.5) * 2 * amt;   // ragged natural edges
// the beard's top edge: a curve that dips below the cheeks and climbs up the sides into sideburns
const cheekLine = (x, az) => {
  const side = smooth(0.55, 1.5, Math.abs(az));
  const u = Math.abs(x);
  const stacheTop = FACE.mouthY + 0.2 - 0.05 * smooth(0.0, 0.3, u);
  const dip = FACE.mouthY + 0.1 - 0.05 * smooth(0.3, 0.5, u);
  return lerpN(u < 0.32 ? stacheTop : dip, FACE.eyeY - 0.02, side);
};
const lerpN = (a, b, t) => a + (b - a) * t;
const lowerFace = (minY, len) => (x, y, az) => {
  if (inMouth(x, y)) return 0;
  if (Math.abs(az) > 2.1) return 0;                                            // nothing on the back of the head
  if (y > cheekLine(x, az) + jag(x, y)) return 0;
  if (y < minY) return 0;
  return len(x, y);
};
function stacheTip(sx, palette, curl) {   // the curled end of a handlebar
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, a = t * curl; pts.push([sx * (0.2 + 0.25 * t + 0.05 * Math.sin(a)), FACE.mouthY + 0.13 + 0.06 * t + 0.07 * (1 - Math.cos(a)) * t]); }
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => { const s = surfaceAt(x, y, SMOOTH); return s.p.addScaledVector(s.n, 0.03); }));
  const geo = new THREE.TubeGeometry(curve, 40, 0.028, 8);
  const pa = geo.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {   // taper to a point
    const t = Math.floor(i / 9) / 40; c.copy(curve.getPoint(t)); q.fromBufferAttribute(pa, i).sub(c).multiplyScalar(1 - t * 0.85).add(c); pa.setXYZ(i, q.x, q.y, q.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, std(new THREE.Color(palette[0]), { roughness: 0.6 }));
}

const BEARDS = [
  ['fullbeard', '🧔 Full Beard', 'brown', 2600, lowerFace(-0.95, (x, y) => 0.1 + 0.22 * smooth(FACE.mouthY - 0.05, -0.8, y))],
  ['lumberjack', '🪓 Lumberjack Beard (ginger)', 'ginger', 3000, lowerFace(-1.0, (x, y) => 0.13 + 0.3 * smooth(FACE.mouthY - 0.05, -0.85, y))],
  ['wizard', '🧙 Long Grey Beard', 'grey', 3000, lowerFace(-0.9, (x, y) => 0.12 + 0.75 * smooth(FACE.mouthY - 0.1, -0.85, y) * (1 - 0.5 * Math.abs(x)))],
  ['blackbeard', '🏴‍☠️ Black Beard', 'black', 2600, lowerFace(-0.95, (x, y) => 0.1 + 0.32 * smooth(FACE.mouthY - 0.05, -0.8, y))],
  ['goatee', '🐐 Goatee', 'brown', 900, (x, y) => {
    if (inMouth(x, y)) return 0; const w = y - FACE.mouthY, u = Math.abs(x) + jag(x, y, 0.02);
    const stache = w > 0.08 && w < 0.19 && u < 0.27 - 0.08 * smooth(0.08, 0.19, w);
    const chin = w < 0.02 && w > -0.5 && u < 0.24 * Math.sqrt(Math.max(0, 1 - ((w + 0.18) / 0.32) ** 2));
    const link = u > 0.19 && u < 0.27 && w <= 0.08 && w >= 0.0;
    return (stache || chin || link) ? 0.08 + 0.14 * smooth(FACE.mouthY - 0.1, FACE.mouthY - 0.45, y) : 0; }],
  ['chinstrap', '➰ Chinstrap', 'black', 1100, (x, y, az) => {
    // a thin strip that follows the jaw from one sideburn, under the chin, to the other
    const A = Math.abs(az); if (A > 1.95) return 0;
    const t = smooth(0.2, 1.6, A);                                   // 0 under the chin, 1 at the side
    const lineY = lerpN(FACE.mouthY - 0.4, FACE.eyeY - 0.05, t * t);
    const band = 0.055 + 0.02 * t;
    if (y > FACE.eyeY - 0.02) return 0;
    if (A > 1.3) return (A < 1.75) ? 0.06 : 0;                       // sideburn running up the side
    return Math.abs(y - lineY + jag(x, y, 0.012)) < band ? 0.06 : 0; }],
].map(([id, name, pal, count, shape]) => ({ id, name, build() {
  const g = new THREE.Group(); const sway = new THREE.Group(); sway.position.set(0, FACE.mouthY, 0.3); g.add(sway);
  const m = facialHair({ count, shape, palette: HAIR[pal] }); m.position.set(0, -FACE.mouthY, -0.3); sway.add(m);
  const sx = spring(35, 4), sz = spring(35, 4); let pj = 0;
  return { obj: g, update(st) {
    sway.rotation.x = sx.step(st.dt, 0, -st.drot.x * 0.012 + (st.jaw - pj) * 0.6 + st.kick * 0.05);
    sway.rotation.z = sz.step(st.dt, 0, -st.drot.z * 0.012 - st.drot.y * 0.006); pj = st.jaw;
  } };
} }));

const STACHES = [
  ['chevron', '🥸 Chevron', 'brown', 900, (x, y) => { const w = y - FACE.mouthY, u = Math.abs(x); return (u < 0.3 && w > 0.09 && w < 0.21 - 0.07 * u / 0.3) ? 0.09 : 0; }],
  ['pencil', '✏️ Pencil Mustache', 'black', 380, (x, y) => { const w = y - FACE.mouthY, u = Math.abs(x); return (u < 0.25 && u > 0.02 && w > 0.1 && w < 0.135) ? 0.05 : 0; }],
  ['horseshoe', '🐴 Horseshoe', 'blonde', 1300, (x, y) => { const w = y - FACE.mouthY, u = Math.abs(x); const top = u < 0.3 && w > 0.09 && w < 0.2; const bars = u > 0.23 && u < 0.32 && w > -0.42 && w < 0.2; return (top || bars) && !inMouth(x, y) ? 0.09 : 0; }],
  ['handlebar', '🎩 Handlebar', 'brown', 700, (x, y) => { const w = y - FACE.mouthY, u = Math.abs(x); return (u < 0.24 && w > 0.095 && w < 0.18 - 0.04 * u / 0.24) ? 0.08 : 0; }, true],
  ['walrus', '🦭 Walrus', 'grey', 1500, (x, y) => { const w = y - FACE.mouthY, u = Math.abs(x); return (u < 0.33 && w > 0.06 && w < 0.24 - 0.06 * u / 0.33) ? 0.17 : 0; }],
].map(([id, name, pal, count, shape, tips]) => ({ id, name, build() {
  const g = new THREE.Group();
  g.add(facialHair({ count, shape, palette: HAIR[pal], outward: 0.3, spread: 0.7, w: 0.014, droop: 0.3 }));
  if (tips) for (const sx of [-1, 1]) g.add(stacheTip(sx, HAIR[pal], 3.6));
  const tw = spring(120, 7); let pj = 0;
  return { obj: g, update(st) { const x = tw.step(st.dt, 0, (st.jaw - pj) * 2 + (st.smile - (this._ps || 0)) * 2); pj = st.jaw; this._ps = st.smile; g.position.y = x * 0.02; g.scale.x = 1 + x * 0.06; } };
} }));

function mullet(pal, { curly = 0, length = 0.75, rattail = false } = {}) {
  const palette = HAIR[pal], top = [], back = [];
  const hairline = FACE.eyeY + 0.32;
  const topZone = (p, az) => {
    const front = Math.abs(az) < 1.1;
    const line = hairline - 0.1 * (Math.abs(p.x) / 0.6) ** 2 + 0.06 * Math.exp(-(((Math.abs(p.x) - 0.38) / 0.1) ** 2)) + jag(p.x, p.y, 0.025);   // rounded hairline with temples
    if (front && p.y < line) return false;
    if (!front && Math.abs(az) < 2.0 && p.y < FACE.eyeY + 0.05) return false;
    if (Math.abs(az) >= 2.0 && p.y < FACE.eyeY - 0.1) return false;
    return true;
  };
  const backZone = (p, az) => Math.abs(az) > 1.75 && p.y < FACE.eyeY + 0.1 && p.y > FACE.mouthY - 0.15;
  const combed = n => { const t = new THREE.Vector3(0, 0.25, -1).addScaledVector(n, -n.dot(new THREE.Vector3(0, 0.25, -1))); return t.lengthSq() > 1e-4 ? t.normalize() : new THREE.Vector3(0, -1, 0); };
  // business in the front: short and combed back, with a bit of lift
  for (const h of scatter(6500, (p, az) => topZone(p, az) ? {} : null)) {
    const dir = combed(h.n).multiplyScalar(0.75).addScaledVector(h.n, 0.45 + curly * 0.4).add(new THREE.Vector3((rnd() - 0.5) * curly, (rnd() - 0.5) * curly, (rnd() - 0.5) * curly)).normalize();
    top.push({ p: h.p.clone().addScaledVector(h.n, 0.006), dir, len: 0.12 + rnd() * 0.1 + curly * 0.08, w: 0.018 + rnd() * 0.01, color: pick(palette), droop: h.n.clone().negate() });
  }
  // party in the back: long hair falling down
  for (const h of scatter(5000, (p, az) => backZone(p, az) ? {} : null)) {
    const dir = new THREE.Vector3(0, -1, 0).addScaledVector(h.n, 0.18 + curly * 0.3).add(new THREE.Vector3((rnd() - 0.5) * curly * 0.5, 0, (rnd() - 0.5) * curly * 0.5)).normalize();
    back.push({ p: h.p.clone().addScaledVector(h.n, 0.006), dir, len: length * (0.7 + rnd() * 0.5) * (0.6 + 0.4 * smooth(FACE.eyeY + 0.1, FACE.mouthY, h.p.y)), w: 0.016 + rnd() * 0.01, color: pick(palette), droop: h.n.clone().negate() });
  }
  if (rattail) for (let i = 0; i < 160; i++) {
    const p = ringPoint(FACE.mouthY - 0.1 + rnd() * 0.06, Math.PI + (rnd() - 0.5) * 0.12, 0.01);
    back.push({ p, dir: new THREE.Vector3((rnd() - 0.5) * 0.08, -1, -0.15).normalize(), len: 0.8 + rnd() * 0.35, w: 0.016, color: pick(palette), droop: new THREE.Vector3(0, 0, -1) });
  }
  const g = new THREE.Group();
  g.add(hairBase((p, az) => topZone(p, az) || backZone(p, az), palette[0]));
  g.add(strandMesh(top, 0.35 + curly * 0.3));
  const piv = new THREE.Group(); piv.position.set(0, FACE.eyeY + 0.1, -0.55); g.add(piv);
  const bm = strandMesh(back, 0.12 + curly * 0.5); bm.position.set(0, -(FACE.eyeY + 0.1), 0.55); piv.add(bm);
  const sx = spring(22, 2.6), sz = spring(22, 2.6);
  return { obj: g, update(st) {
    piv.rotation.x = sx.step(st.dt, 0, -st.drot.x * 0.03 + st.kick * 0.25);
    piv.rotation.z = sz.step(st.dt, 0, -st.drot.z * 0.03 - st.drot.y * 0.015) + Math.sin(st.t * 1.5) * 0.004;
  } };
}
const HAIRDOS = [
  { id: 'mullet', name: '🦅 Classic Mullet', build: () => mullet('brown') },
  { id: 'mullet80s', name: '🎸 80s Blonde Mullet', build: () => mullet('blonde', { curly: 0.7, length: 0.85 }) },
  { id: 'gingermullet', name: '🔥 Ginger Mullet', build: () => mullet('ginger', { length: 0.7 }) },
  { id: 'joedirt', name: '🧢 Dirty Mullet + Rat Tail', build: () => mullet('dirty', { length: 0.6, rattail: true }) },
  { id: 'blackmullet', name: '🖤 Black Mullet', build: () => mullet('black', { length: 0.9 }) },
];

const NECK_IDS = ['chain', 'bowtie', 'scarf'];
export const SLOTS = [
  { id: 'hair', name: 'Hair', anchor: 'head' }, { id: 'head', name: 'Head', anchor: 'head' }, { id: 'beard', name: 'Beard', anchor: 'head' },
  { id: 'stache', name: 'Mustache', anchor: 'head' }, { id: 'face', name: 'Face', anchor: 'head' },
  { id: 'eyes', name: 'Eyewear', anchor: 'head' }, { id: 'ears', name: 'Ears', anchor: 'head' },
  { id: 'neck', name: 'Neck', anchor: 'waist' }, { id: 'body', name: 'Body', anchor: 'waist' }, { id: 'back', name: 'Back', anchor: 'waist' }
];
export const ITEMS = [
  ...HAIRDOS.map(i => ({ ...i, slot: 'hair' })), ...BEARDS.map(i => ({ ...i, slot: 'beard' })), ...STACHES.map(i => ({ ...i, slot: 'stache' })),
  ...[...MIL_HEAD, ...HEAD].map(i => ({ ...i, slot: 'head' })), ...MIL_FACE.map(i => ({ ...i, slot: 'face' })),
  ...[...EYES, ...MIL_EYES].map(i => ({ ...i, slot: 'eyes' })), ...EARS.map(i => ({ ...i, slot: 'ears' })),
  ...[...BODY.filter(i => NECK_IDS.includes(i.id)), ...MIL_NECK].map(i => ({ ...i, slot: 'neck' })),
  ...[...BODY.filter(i => !NECK_IDS.includes(i.id)), ...MIL_BODY].map(i => ({ ...i, slot: 'body' })),
  ...MIL_BACK.map(i => ({ ...i, slot: 'back' }))
];
export const DEFAULT_OUTFIT = { hair: 'none', beard: 'none', stache: 'none', head: 'none', face: 'none', eyes: 'none', ears: 'none', neck: 'none', body: 'none', back: 'none' };
