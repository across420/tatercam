// TaterCam wardrobe. Every item is built from code and shaped to fit the potato.
// Each item: { id, slot, name, build() -> { obj, update(st), steam? } }
// st = { t, dt, jaw, smile, rot, drot:{x,y,z}, kick, visorDown, nvgDown }
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FACE, TOP, outerPoint, shapeNormal, surfaceAt, ringPoint, halfWidthAt, smooth, vnoise } from './tater.js';

const TAU = Math.PI * 2, Z = new THREE.Vector3(0, 0, 1);

// ---------- model quality helpers ----------
// Rounded boxes instead of sharp ones: edges catch the light like real objects.
const RBox = (w, h, d) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(w, h, d) * 0.22));
// Flat webbing strap that follows a path and lies against the body (instead of a round hose).
function ribbon(points, width, mat, thick = 0.012) {
  const curve = new THREE.CatmullRomCurve3(points), N = Math.max(24, points.length * 12), pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPoint(t), tan = curve.getTangent(t).normalize();
    const out = new THREE.Vector3(p.x, p.y * 0.25, p.z).normalize(), side = new THREE.Vector3().crossVectors(tan, out).normalize();
    for (const [sw, so] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { const q = p.clone().addScaledVector(side, sw * width / 2).addScaledVector(out, so * thick); pos.push(q.x, q.y, q.z); uv.push(sw > 0 ? 1 : 0, t * N / 6); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
// Tileable surface-detail maps, built once and shared.
const DETAIL = {};
function detailTex(kind) {
  if (DETAIL[kind]) return DETAIL[kind];
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
  const r2 = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0.5;
    if (kind === 'weave') {            // Cordura-style basket weave
      const cx = x % 8, cy = y % 8, a = ((x >> 3) + (y >> 3)) & 1;
      const warp = Math.sin((a ? cx : cy) / 8 * Math.PI), weft = Math.sin((a ? cy : cx) / 8 * Math.PI) * 0.3;
      v = 0.35 + warp * 0.45 + weft * 0.2 + (r2(x, y) - 0.5) * 0.12;
    } else if (kind === 'grain') {     // matte paint / plastic speckle
      v = 0.5 + (r2(x, y) - 0.5) * 0.5 + (r2(x >> 2, y >> 2) - 0.5) * 0.25;
    } else if (kind === 'scratch') {   // worn metal: fine scratches on a brushed base
      v = 0.55 + (r2(x, y >> 4) - 0.5) * 0.15;
      if (r2(Math.floor((x + y * 0.3) / 3), 7) > 0.985) v = 0.25;
      if (r2(Math.floor((x * 0.4 - y) / 2), 11) > 0.99) v = 0.3;
    } else if (kind === 'rubber') {
      v = 0.5 + (r2(x, y) - 0.5) * 0.2 + Math.sin(x * 0.4) * Math.sin(y * 0.4) * 0.05;
    }
    const o = (y * N + x) * 4, b = Math.max(0, Math.min(255, v * 255)); d[o] = d[o + 1] = d[o + 2] = b; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.userData.shared = true;
  return (DETAIL[kind] = t);
}
// Give every solid material real surface detail based on what it's made of.
function finishModel(root) {
  const seen = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!m || !m.isMeshStandardMaterial || m.transparent || m.alphaMap || m.bumpMap || m.normalMap) return;
      if (m.emissive && m.emissive.getHex() !== 0) return;
      if (!o.geometry.attributes.uv) return;
      let kind = m.metalness > 0.5 ? 'scratch' : m.roughness >= 0.86 ? 'weave' : m.roughness <= 0.62 && m.roughness >= 0.5 && m.color.getHSL({}).l < 0.2 ? 'rubber' : 'grain';
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const rep = Math.max(1, Math.round(o.geometry.boundingSphere.radius * (kind === 'weave' ? 20 : 10)));
      const key = m.uuid;
      if (seen.has(key)) return;
      seen.set(key, true);
      const tex = detailTex(kind).clone(); tex.repeat.set(rep, rep); tex.userData.shared = false; tex.needsUpdate = true;
      m.bumpMap = tex; m.bumpScale = kind === 'weave' ? 1.6 : kind === 'scratch' ? 0.5 : kind === 'rubber' ? 0.6 : 0.8;
      if (kind === 'scratch') { m.roughnessMap = tex; m.roughness = Math.min(1, m.roughness + 0.25); }
      m.needsUpdate = true;
    });
  });
  return root;
}
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
  if (tube <= 0.04 && !sag) return band(y - tube * 1.4, y + tube * 1.4, extra, mat);
  const pts = []; for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, fr = Math.max(0, Math.cos(a)); pts.push(ringPoint(y - sag * fr * fr, a, extra)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, tube, 12, true), mat);
}
function spring(k = 80, d = 9) { return { x: 0, v: 0, step(dt, target, kick = 0) { this.v += kick + ((target - this.x) * k - this.v * d) * dt; this.x += this.v * dt; if (!isFinite(this.x) || !isFinite(this.v)) { this.x = 0; this.v = 0; } this.x = Math.max(-3, Math.min(3, this.x)); return this.x; } }; }
function strobe(parent, pos) {
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }));
  const box = new THREE.Mesh(RBox(0.1, 0.07, 0.1), std(0x222222)); box.position.copy(pos); light.position.set(0, 0.05, 0); box.add(light); parent.add(box);
  return t => { light.material.emissiveIntensity = (t % 1.2) < 0.08 ? 4 : 0; };
}
const eyeTheta = Math.acos(FACE.eyeY / TOP);   // where the eyes sit on the sphere map

// ======================= HEAD =======================
const HEAD = [
  { id: 'toppings', name: '🧈 Butter & Sour Cream', build() {
    const g = new THREE.Group();
    const top = outerPoint(new THREE.Vector3(0, 1, 0));
    const butter = new THREE.Mesh(RBox(0.4, 0.12, 0.32, 4, 2, 4), std(0xffd84d, { roughness: 0.3 }));
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
    for (const sx of [-1, 1]) g.add(placeOn(new THREE.Mesh(RBox(0.62, 0.11, 0.06), railMat), 1.1, [sx, 0.55, 0], 0.03));
    const shroud = placeOn(new THREE.Mesh(RBox(0.28, 0.18, 0.06), railMat), 1.1, [0, 0.62, 0.78], 0.03); g.add(shroud);
    const notch = new THREE.Mesh(RBox(0.11, 0.07, 0.03), std(0x111111)); notch.position.set(0, -0.03, 0.035); shroud.add(notch);
    const patch = placeOn(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshStandardMaterial({ map: patchTex('TATER', '#3b3a2e', '#d8c690'), roughness: 0.95 })), 1.1, [0, 0.55, -0.83], 0.012);
    patch.rotateZ(Math.PI); g.add(patch);
    g.add(placeOn(new THREE.Mesh(RBox(0.32, 0.2, 0.1), std(0x6f6248, { roughness: 0.95 })), 1.1, [0, 0.35, -1], 0.05));
    const blink = strobe(g, outerPoint(new THREE.Vector3(0, 1, -0.25).normalize()).multiplyScalar(1.1).add(new THREE.Vector3(0, 0.03, 0)));
    return { obj: g, update(st) { blink(st.t); } };
  } },

  { id: 'altyn', name: '🛡️ Heavy Assault Helmet + Visor (V)', build() {
    const g = new THREE.Group();
    const olive = std(0x5a5f44, { roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    const th = eyeTheta - 0.2;
    g.add(shell(1.12, th, olive)); g.add(ring(1.12, th, 0.035, std(0x2d2f24, { roughness: 0.8 })));
    const ap = FACE.eyeY + 0.12, visor = new THREE.Group(); visor.position.y = ap; g.add(visor);
    const aIn = new THREE.Group(); aIn.position.y = -ap; visor.add(aIn);
    const vm = std(0x646a4c, { roughness: 0.42, metalness: 0.5, side: THREE.DoubleSide });
    const part = (t0, t1, p0 = Math.PI / 2 - 1.0, pl = 2.0) => new THREE.Mesh(conform(new THREE.SphereGeometry(1, 56, 16, p0, pl, t0, t1 - t0), 1.2), vm);
    aIn.add(part(eyeTheta - 0.34, eyeTheta - 0.08)); aIn.add(part(eyeTheta + 0.07, eyeTheta + 0.75));
    for (const sx of [-1, 1]) {
      aIn.add(part(eyeTheta - 0.09, eyeTheta + 0.08, Math.PI / 2 + sx * 0.97 - 0.06, 0.12));
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 20), std(0x3c3f30, { metalness: 0.6, roughness: 0.4 }));
      bolt.rotation.z = Math.PI / 2; bolt.position.copy(ringPoint(FACE.eyeY + 0.12, sx * Math.PI / 2, 0.2)); g.add(bolt);
    }
    let a = 0;
    return { obj: g, update(st) { a += ((st.visorDown ? 0 : -0.75) - a) * Math.min(1, st.dt * 7); const k = -a / 0.75; visor.rotation.x = a; visor.position.set(0, ap + 0.12 * k, -0.42 * k); } };
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
    for (const [s, c] of [[1, 0xe53935], [-1, 0xfdd835]]) { const b = new THREE.Mesh(RBox(0.4, 0.015, 0.1), std(c)); b.position.x = s * 0.21; b.rotation.x = s * 0.35; prop.add(b); }
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
    mount.add(new THREE.Mesh(RBox(0.22, 0.12, 0.1), dark));
    const dy = FACE.eyeY - my, dz = frontZ(FACE.eyeY) + 0.32 - mount.position.z;
    const arm = new THREE.Mesh(RBox(0.09, Math.abs(dy) + 0.05, 0.07), dark); arm.position.set(0, dy / 2, dz * 0.45); arm.rotation.x = -Math.atan2(dz, -dy) * 0.6; mount.add(arm);
    const housing = new THREE.Mesh(RBox(0.72, 0.19, 0.2), dark); housing.position.set(0, dy, dz - 0.18); mount.add(housing);
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
    for (const sx of [-1, 1]) { const t = new THREE.Mesh(RBox(0.03, 0.035, 0.6), std(0x151515)); t.position.set(sx * rx * 0.97, 0.1, -0.1); g.add(t); }
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
  { id: 'platecarrier', name: '🦺 Plate Carrier', build: () => armor({ tex: () => camoTex('#7b7356', ['#5f6b45', '#9a8a62', '#4a4232', '#c2b48a']), mags: 3, patch: ['TATER', '#2f3326', '#e0d29a'] }) },
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
    const tail = new THREE.Mesh(RBox(0.24, 0.7, 0.07), mat); tail.position.y = -0.34; tailPivot.add(tail);
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
function surfacePatch(x0, x1, y0, y1, off, mat, keep = null, nu = 40, nv = 30) {   // a sheet laid over the face; keep() cuts smooth holes/outlines
  nu = Math.max(nu, 48); nv = Math.max(nv, 40);
  const pos = [], idx = [], uv = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const x = x0 + (x1 - x0) * i / nu, y = y0 + (y1 - y0) * j / nv, s = surfaceAt(x, y, SMOOTH);
    const p = s.p.addScaledVector(s.n, off); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  if (keep) {   // smooth-edged cutout from a high-res mask instead of chunky missing squares
    const R = 256, alpha = canvasTex(R, R, (c, w, h) => {
      const img = c.createImageData ? c.createImageData(w, h) : null; if (!img) return;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        let k = 0; for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) k += keep(x0 + (x1 - x0) * (xx + ox) / w, y0 + (y1 - y0) * (1 - (yy + oy) / h)) ? 1 : 0;
        const o = (yy * w + xx) * 4, v = k * 63.75; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    alpha.wrapS = alpha.wrapT = THREE.ClampToEdgeWrapping; alpha.colorSpace = THREE.NoColorSpace;
    mat = mat.clone(); mat.alphaMap = alpha;
    if (!mat.transparent) mat.alphaTest = 0.5;
  }
  return new THREE.Mesh(g, mat);
}
function akMag(mat) {   // curved AK magazine
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(RBox(0.075, 0.085, 0.045), mat); b.position.set(i * i * 0.006, -i * 0.08, 0); b.rotation.z = i * 0.09; g.add(b); }
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
    const flash = new THREE.Mesh(RBox(0.16, 0.18, 0.02), std(0x2a3a7a)); flash.position.set(0.32, 0.06, 0.42); flash.rotation.y = 0.6; g.add(flash);
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
    mount.add(new THREE.Mesh(RBox(0.2, 0.12, 0.08), dark));
    const x = FACE.eyeX, dy = FACE.eyeY - my, dz = frontZ(FACE.eyeY) + 0.3 - mount.position.z;
    const arm = new THREE.Mesh(RBox(0.34, 0.07, 0.07), dark); arm.position.set(x / 2, dy * 0.5, dz * 0.4); arm.rotation.z = Math.atan2(dy * 0.5, x); mount.add(arm);
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
    const panel = new THREE.Mesh(RBox(0.98, 0.42, 0.14), cloth); panel.position.set(0, y, zf + 0.03); g.add(panel);
    const magMat = std(0x3a2a1c, { roughness: 0.5, metalness: 0.15 });
    for (let i = 0; i < 4; i++) {
      const x = -0.33 + i * 0.22;
      const p = new THREE.Mesh(RBox(0.17, 0.3, 0.12), cloth); p.position.set(x, y - 0.02, zf + 0.14); g.add(p);
      const m = akMag(magMat); m.position.set(x - 0.01, y + 0.2, zf + 0.14); m.rotation.z = Math.PI; m.scale.set(0.9, 0.55, 0.9); g.add(m);
    }
    g.add(loop(y + 0.12, 0.07, 0.035, strap));
    for (const sx of [-1, 1]) {   // shoulder straps up the sides
      const pts = [ringPoint(y + 0.15, sx * 0.5, 0.07), ringPoint(-0.3, sx * 0.9, 0.06), ringPoint(-0.05, sx * 1.6, 0.05), ringPoint(y + 0.12, sx * 2.6, 0.07)];
      g.add(ribbon(pts, 0.09, strap, 0.02));
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
      const t = new THREE.Mesh(RBox(0.11, 0.17, 0.01), steel); t.position.set(dx, -0.1, 0.02); t.rotation.z = rz; piv.add(t); tags.push(t);
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
    const pack = new THREE.Mesh(RBox(0.62, 0.62, 0.3), std(0x4c513a, { roughness: 0.9 })); pack.position.set(0.05, y, zb - 0.15); g.add(pack);
    const radio = new THREE.Mesh(RBox(0.4, 0.28, 0.12), std(0x2a2c26, { roughness: 0.6, metalness: 0.2 })); radio.position.set(0.05, y + 0.2, zb - 0.32); g.add(radio);
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


// ======================= TARKOV / CALL OF DUTY PACK =======================
const tanTex = () => camoTex('#b39a72', ['#a38b63', '#c2aa80', '#9a845e']);
const atacsTex = () => camoTex('#7e7a6a', ['#5d5a4c', '#a39d86', '#3e3c33', '#8c8774']);
const flora = () => camoTex('#6a7a4a', ['#3f4a2a', '#8a8a5a', '#2a2e1e', '#a09060']);
const blackMat = (o = {}) => std(0x1c1d1f, { roughness: 0.6, ...o });
const steelMat = () => std(0x6e7378, { metalness: 0.85, roughness: 0.4 });
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(RBox(w, h, d), mat); m.position.set(x, y, z); if (parent) parent.add(m); return m; }
function cyl(r1, r2, h, mat, parent, seg = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); if (parent) parent.add(m); return m; }
const helmetEdge = (front, side, back) => phi => { const f = Math.sin(phi); return f >= 0 ? lerpN(side, front, f) : lerpN(side, back, -f); };

// ---- guns (built along +x, muzzle at +x) ----
function akRifle() {
  const g = new THREE.Group(), wood = std(0x8a4a22, { roughness: 0.55 }), metal = std(0x2a2b2d, { roughness: 0.45, metalness: 0.6 });
  box(0.55, 0.11, 0.07, metal, 0, 0, 0, g);                                   // receiver
  box(0.28, 0.1, 0.075, wood, 0.42, -0.005, 0, g);                            // handguard
  box(0.22, 0.04, 0.05, wood, 0.4, 0.07, 0, g);                               // upper handguard
  const bar = cyl(0.016, 0.016, 0.45, metal, g); bar.rotation.z = Math.PI / 2; bar.position.set(0.75, 0.02, 0);
  const brake = cyl(0.025, 0.025, 0.07, metal, g); brake.rotation.z = Math.PI / 2; brake.position.set(0.98, 0.02, 0);
  box(0.03, 0.06, 0.02, metal, 0.9, 0.06, 0, g);                              // front sight
  const stock = box(0.42, 0.1, 0.06, wood, -0.45, -0.04, 0, g); stock.rotation.z = 0.12;
  const grip = box(0.06, 0.14, 0.05, wood, -0.12, -0.11, 0, g); grip.rotation.z = -0.3;
  const mag = akMag(std(0x5a2e1a, { roughness: 0.5 })); mag.position.set(0.12, -0.06, 0); mag.rotation.z = Math.PI + 0.25; mag.scale.setScalar(1.15); g.add(mag);
  return g;
}
function m4Rifle() {
  const g = new THREE.Group(), blk = std(0x1e1f21, { roughness: 0.5, metalness: 0.4 }), fde = std(0x9b8460, { roughness: 0.7 });
  box(0.5, 0.11, 0.07, blk, 0, 0, 0, g);
  box(0.36, 0.09, 0.08, blk, 0.43, 0.005, 0, g);                              // rail handguard
  box(0.78, 0.02, 0.03, blk, 0.2, 0.065, 0, g);                               // top rail
  const bar = cyl(0.014, 0.014, 0.3, blk, g); bar.rotation.z = Math.PI / 2; bar.position.set(0.76, 0.01, 0);
  const sup = cyl(0.03, 0.03, 0.22, blk, g); sup.rotation.z = Math.PI / 2; sup.position.set(1.0, 0.01, 0);   // suppressor
  box(0.3, 0.09, 0.06, fde, -0.42, -0.02, 0, g);                              // stock
  box(0.08, 0.04, 0.04, blk, -0.2, 0.0, 0, g);                                // buffer tube
  const grip = box(0.05, 0.13, 0.045, fde, -0.13, -0.1, 0, g); grip.rotation.z = -0.3;
  const mag = box(0.075, 0.24, 0.05, fde, 0.1, -0.15, 0, g); mag.rotation.z = -0.12;
  const optic = cyl(0.035, 0.035, 0.12, blk, g); optic.rotation.z = Math.PI / 2; optic.position.set(0.05, 0.12, 0);
  const vfg = box(0.04, 0.1, 0.04, blk, 0.5, -0.09, 0, g);
  return g;
}
function slungGun(make, side = 1) {   // rifle hanging diagonally across the back
  const g = new THREE.Group(), y = -0.55, zb = ringPoint(y, Math.PI, 0.05).z;
  const gun = make(); gun.scale.setScalar(1.1); gun.position.set(0, y, zb - 0.12); gun.rotation.set(0, Math.PI, side * 0.75); g.add(gun);
  const pts = [ringPoint(-0.95, side * 2.4, 0.06), ringPoint(-0.6, side * 1.0, 0.07), ringPoint(-0.25, side * -0.6 + Math.PI * 0, 0.06), ringPoint(-0.15, side * -2.0, 0.06), ringPoint(-0.2, Math.PI, 0.08)];
  g.add(ribbon(pts, 0.06, std(0x2b2a22, { roughness: 0.95 }), 0.012));
  const sw = spring(30, 3);
  return { obj: g, update(st) { gun.rotation.z = side * 0.75 + sw.step(st.dt, 0, -st.drot.z * 0.05 - st.drot.y * 0.03 + st.kick * 0.3); } };
}
function headset2({ shellColor, capColor, slim = false, mic = true, cable = false }) {
  const g = new THREE.Group(), sh = std(shellColor, { roughness: 0.7 }), cp = std(capColor, { roughness: 0.7 });
  const cy = 0.3, cx = halfWidthAt(cy) + 0.08;
  for (const sx of [-1, 1]) {
    const cup = cyl(slim ? 0.22 : 0.27, slim ? 0.23 : 0.29, slim ? 0.11 : 0.17, sh, g, 28); cup.rotation.z = Math.PI / 2; cup.position.set(sx * cx, cy, -0.02);
    if (slim) cup.scale.set(1, 1, 1.35);
    const c = cyl(slim ? 0.15 : 0.2, slim ? 0.17 : 0.24, 0.05, cp, g, 28); c.rotation.z = Math.PI / 2; c.position.set(sx * (cx + (slim ? 0.07 : 0.1)), cy, -0.02);
    if (slim) c.scale.set(1, 1, 1.35);
    const knob = cyl(0.03, 0.03, 0.05, blackMat(), g, 12); knob.rotation.x = Math.PI / 2; knob.position.set(sx * (cx + 0.05), cy - 0.2, 0.12);
  }
  const b = new THREE.Mesh(new THREE.TorusGeometry(cx, 0.04, 10, 56, Math.PI), sh); b.position.y = cy; b.scale.y = (TOP + 0.08 - cy) / cx; g.add(b);
  if (mic) {
    const mz = frontZ(FACE.mouthY);
    const curve = new THREE.CatmullRomCurve3([[cx + 0.04, 0.2, 0.1], [cx - 0.05, -0.08, 0.45], [0.5, FACE.mouthY - 0.12, mz - 0.05], [0.3, FACE.mouthY - 0.08, mz + 0.06]].map(p => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.018, 8), blackMat()));
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), blackMat({ roughness: 1 })); foam.position.copy(curve.getPoint(1)); g.add(foam);
  }
  if (cable) { const c = new THREE.CatmullRomCurve3([[-cx, cy - 0.25, -0.05], [-cx + 0.1, -0.4, 0.1], [-0.5, -0.9, 0.4]].map(p => new THREE.Vector3(...p))); g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.015, 6), blackMat())); }
  return { obj: g, update() {} };
}
function armor({ tex, color, collar = false, shoulders = false, mags = 0, pistolMag = false, admin = false, patch = null, low = -1.2, high = -0.4, bulk = 0.1 }) {
  const g = new THREE.Group();
  const cloth = tex ? new THREE.MeshStandardMaterial({ map: tex(), roughness: 0.95, side: THREE.DoubleSide }) : std(color, { roughness: 0.95, side: THREE.DoubleSide });
  const dark = tex ? std(0x2a2a24, { roughness: 0.95 }) : std(new THREE.Color(color).multiplyScalar(0.6), { roughness: 0.95 });
  const webbing = tex ? cloth : std(new THREE.Color(color).multiplyScalar(0.8), { roughness: 0.92 });
  const yP = (low + high) / 2, plateH = high - low - 0.04, plateW = 0.84, zf = ringPoint(yP, 0, bulk).z;
  // cummerbund wrapping the sides, with elastic edge binding
  g.add(band(low + 0.08, high - 0.12, bulk - 0.02, cloth));
  // front plate bag: curved to the body, rounded corners, bound edges
  const plate = new THREE.Group(); plate.position.set(0, yP, zf + 0.02); g.add(plate);
  const pg = new RoundedBoxGeometry(plateW, plateH, 0.12, 4, 0.05), pp = pg.attributes.position;
  for (let i = 0; i < pp.count; i++) { const x = pp.getX(i); pp.setZ(i, pp.getZ(i) - 0.35 * x * x); }
  pg.computeVertexNormals(); plate.add(new THREE.Mesh(pg, cloth));
  { const ep = new RoundedBoxGeometry(plateW + 0.02, plateH + 0.02, 0.1, 4, 0.05), q = ep.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i); q.setZ(i, q.getZ(i) - 0.35 * x * x); } ep.computeVertexNormals(); const edge = new THREE.Mesh(ep, dark); edge.position.z = -0.012; plate.add(edge); }
  // MOLLE webbing rows with bar-tack stitching
  const rows = Math.max(2, Math.floor(plateH / 0.1) - 1);
  for (let r = 0; r < rows; r++) {
    const y = -plateH / 2 + 0.08 + r * 0.085;
    const row = new THREE.Mesh(new RoundedBoxGeometry(plateW - 0.08, 0.032, 0.012, 2, 0.005), webbing);
    const rp = row.geometry.attributes.position; for (let i = 0; i < rp.count; i++) { const x = rp.getX(i); rp.setZ(i, rp.getZ(i) - 0.35 * x * x); } row.geometry.computeVertexNormals();
    row.position.set(0, y, 0.066); plate.add(row);
    for (let k = -3; k <= 3; k++) { const x = k * 0.11; box(0.008, 0.034, 0.014, dark, x, y, 0.07 - 0.35 * x * x, plate); }
  }
  // shoulder straps running up and over to the back
  for (const sx of [-1, 1]) {
    const pts = [new THREE.Vector3(sx * 0.3, high - 0.02, zf + 0.04), ringPoint(high + 0.25, sx * 0.55, 0.05), ringPoint(high + 0.32, sx * 1.6, 0.05), ringPoint(high - 0.02, sx * 2.7, bulk)];
    g.add(ribbon(pts, 0.11, cloth, 0.02));
    g.add(ribbon([pts[0], pts[1], pts[2]].map(p => p.clone().multiplyScalar(1.004)), 0.07, dark, 0.03));
  }
  if (collar) { g.add(band(high - 0.04, high + 0.14, bulk + 0.06, cloth)); g.add(band(high + 0.12, high + 0.15, bulk + 0.075, dark)); }
  if (shoulders) for (const sx of [-1, 1]) { const pts = []; for (let k = 0; k <= 6; k++) pts.push(ringPoint(high + 0.08 - k * 0.07, sx * Math.PI / 2, bulk + 0.05 + 0.02 * Math.sin(k / 6 * Math.PI))); g.add(ribbon(pts, 0.42, cloth, 0.06)); g.add(ribbon(pts.map(p => p.clone().multiplyScalar(1.01)), 0.44, dark, 0.012)); }
  // pouches: rounded body, overhanging flap, buckle, mags peeking out
  const magMat = std(0x2b2c2e, { roughness: 0.5, metalness: 0.35 }), buckleMat = std(0x111111, { roughness: 0.4 });
  for (let i = 0; i < mags; i++) {
    const x = (i - (mags - 1) / 2) * 0.19, z = 0.07 - 0.35 * x * x + 0.06;
    const pouch = new THREE.Group(); pouch.position.set(x, -plateH / 2 + 0.17, z); plate.add(pouch);
    pouch.add(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.25, 0.1, 3, 0.03), cloth));
    const mag = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.12, 0.05, 2, 0.012), magMat); mag.position.set(0, 0.15, 0); pouch.add(mag);
    const flap = new THREE.Mesh(new RoundedBoxGeometry(0.165, 0.07, 0.11, 3, 0.025), cloth); flap.position.set(0, 0.1, 0.005); pouch.add(flap);
    const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.035, 0.015, 2, 0.006), buckleMat); buckle.position.set(0, 0.055, 0.06); pouch.add(buckle);
    const bungee = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 16), buckleMat); bungee.position.set(0, 0.2, 0); bungee.rotation.x = Math.PI / 2; pouch.add(bungee);
  }
  if (pistolMag) for (const x of [-0.12, 0.12]) { const pm = new THREE.Group(); pm.position.set(x, plateH / 2 - 0.12, 0.12 - 0.35 * x * x); plate.add(pm); pm.add(new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.15, 0.06, 2, 0.015), cloth)); }
  if (admin) { const ad = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.16, 0.06, 3, 0.02), cloth); ad.position.set(0, plateH / 2 - 0.1, 0.11); plate.add(ad); }
  if (patch) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshStandardMaterial({ map: patchTex(patch[0], patch[1], patch[2]), roughness: 0.9 })); pl.position.set(0, plateH / 2 - 0.1, admin ? 0.145 : 0.075); plate.add(pl); }
  return { obj: g, update() {} };
}
function backpack({ tex, color, w = 0.7, h = 0.85, d = 0.38, bedroll = false, frame = false }) {
  const g = new THREE.Group(), y = -0.55, zb = ringPoint(y, Math.PI, 0.05).z;
  const mat = tex ? new THREE.MeshStandardMaterial({ map: tex(), roughness: 1 }) : std(color, { roughness: 0.95 });
  const body = new THREE.Mesh(RBox(w, h, d, 3, 3, 3), mat); body.position.set(0, y + 0.1, zb - d / 2 - 0.02);
  const p = body.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), yy = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * (1 - 0.08 * (yy / h + 0.5)), yy, z * (0.85 + 0.15 * Math.cos(x / w * 2))); } body.geometry.computeVertexNormals(); g.add(body);
  box(w * 0.7, h * 0.35, 0.1, mat, 0, y - 0.05, zb - d - 0.06, g);           // front pocket
  for (const sx of [-1, 1]) box(0.12, h * 0.5, d * 0.6, mat, sx * (w / 2 + 0.05), y, zb - d / 2, g);
  if (bedroll) { const r = cyl(0.13, 0.13, w + 0.2, std(0x5a6a3a, { roughness: 1 }), g); r.rotation.z = Math.PI / 2; r.position.set(0, y + h / 2 + 0.2, zb - d / 2); }
  if (frame) for (const sx of [-1, 1]) { const t = cyl(0.015, 0.015, h + 0.3, steelMat(), g, 8); t.position.set(sx * (w / 2 - 0.05), y + 0.15, zb - 0.02); }
  for (const sx of [-1, 1]) { const pts = [ringPoint(y + h / 2, Math.PI + sx * 0.4, 0.06), ringPoint(-0.25, sx * 1.2, 0.07), ringPoint(-0.75, sx * 0.9, 0.07), ringPoint(y - 0.3, Math.PI + sx * 0.6, 0.06)]; g.add(ribbon(pts, 0.09, std(0x232320, { roughness: 0.95 }), 0.02)); }
  const sw = spring(28, 3.5); const piv = new THREE.Group(); g.add(piv);
  return { obj: g, update(st) { body.rotation.x = sw.step(st.dt, 0, -st.drot.x * 0.02 + st.kick * 0.15) * 0.3; } };
}

const TK_HEAD = [
  { id: 'killa', name: '🟢 Maska Helmet + Face Shield (V)', build() {
    const g = new THREE.Group(); const green = std(0x4f5a3c, { roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.22, eyeTheta + 0.25, eyeTheta + 0.3);
    g.add(cap(1.12, edge, green)); g.add(capEdge(1.12, edge, 0.035, blackMat()));
    const pivotY = FACE.eyeY + 0.25, visor = new THREE.Group(); visor.position.y = pivotY; g.add(visor);
    const vInner = new THREE.Group(); vInner.position.y = -pivotY; visor.add(vInner);
    const vm = std(0x56603f, { roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide });
    const ex = FACE.eyeX, kx = halfWidthAt(FACE.eyeY) * 0.95, ky0 = FACE.mouthY - 0.35, ky1 = FACE.eyeY + 0.2;
    const keep = (x, y) => { const t = (y - ky0) / (ky1 - ky0); const half = kx * (t > 0.5 ? 1 : Math.sqrt(Math.max(0, 1 - ((0.5 - t) / 0.5) ** 2)) * 0.5 + 0.5); return Math.abs(x) < half && !(Math.abs(y - FACE.eyeY) < 0.045 && Math.abs(Math.abs(x) - ex) < 0.17); };   // eye slits
    vInner.add(surfacePatch(-kx, kx, ky0, ky1, 0.17, vm, keep, 50, 40));
    for (const sx of [-1, 1]) { const b = cyl(0.07, 0.07, 0.06, steelMat(), g, 16); b.rotation.z = Math.PI / 2; b.position.copy(ringPoint(FACE.eyeY + 0.25, sx * Math.PI / 2, 0.16)); }
    let a = -1.0;
    return { obj: g, update(st) { a += ((st.visorDown ? 0 : -1.0) - a) * Math.min(1, st.dt * 7); const k = -a / 1.0; visor.rotation.x = a; visor.position.set(0, pivotY + 0.05 * k, -0.42 * k); } };
  } },
  { id: 'fastmt', name: '⚫ FAST MT Helmet (black, NVG mount)', build() {
    const g = new THREE.Group(); const blk = std(0x2a2b2c, { roughness: 0.75, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.38, eyeTheta - 0.2, eyeTheta + 0.05);
    g.add(cap(1.1, edge, blk)); g.add(capEdge(1.1, edge, 0.03, std(0x141414)));
    for (const sx of [-1, 1]) g.add(placeOn(new THREE.Mesh(RBox(0.55, 0.09, 0.05), std(0x111111, { roughness: 0.5 })), 1.1, [sx, 0.5, 0.05], 0.03));
    const sh = placeOn(new THREE.Group(), 1.1, [0, 0.55, 0.83], 0.03); g.add(sh); box(0.26, 0.17, 0.06, std(0x111111), 0, 0, 0, sh);
    const bat = placeOn(new THREE.Group(), 1.1, [0, 0.35, -1], 0.06); g.add(bat); box(0.3, 0.18, 0.1, std(0x3a3a2a, { roughness: 0.9 }), 0, 0, 0, bat);
    const blink = strobe(g, outerPoint(new THREE.Vector3(0, 1, -0.3).normalize()).multiplyScalar(1.1).add(new THREE.Vector3(0, 0.03, 0)));
    return { obj: g, update(st) { blink(st.t); } };
  } },
  { id: 'airframe', name: '🟫 Airframe Helmet (tan)', build() {
    const g = new THREE.Group(); const tan = new THREE.MeshStandardMaterial({ map: tanTex(), roughness: 0.8, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.35, eyeTheta - 0.15, eyeTheta + 0.1);
    g.add(cap(1.1, edge, tan)); g.add(capEdge(1.1, edge, 0.03, std(0x4a3f2c)));
    for (let i = -2; i <= 2; i++) { const pts = []; for (let k = 0; k <= 20; k++) pts.push(outerPoint(dirAt(0.15 + k / 20 * (eyeTheta - 0.5), Math.PI / 2 + i * 0.35)).multiplyScalar(1.115)); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.02, 6), std(0x9a8462, { roughness: 0.8 }))); }
    for (const sx of [-1, 1]) g.add(placeOn(new THREE.Mesh(RBox(0.5, 0.08, 0.05), std(0x6a5a40)), 1.1, [sx, 0.45, 0.1], 0.03));
    return { obj: g, update() {} };
  } },
  { id: 'kolpak', name: '🚔 Kolpak Riot Helmet (V)', build() {
    const g = new THREE.Group(); const sh = std(0x2c3238, { roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.2, eyeTheta + 0.35, eyeTheta + 0.45);
    g.add(cap(1.12, edge, sh)); g.add(capEdge(1.12, edge, 0.035, blackMat()));
    const kp = FACE.eyeY + 0.3, visor = new THREE.Group(); visor.position.y = kp; g.add(visor);
    const vIn = new THREE.Group(); vIn.position.y = -kp; visor.add(vIn);
    const vg = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ea, transparent: true, opacity: 0.16, roughness: 0.02, clearcoat: 1, envMapIntensity: 2.5, side: THREE.DoubleSide, depthWrite: false });
    const vp = surfacePatch(-halfWidthAt(FACE.eyeY), halfWidthAt(FACE.eyeY), FACE.mouthY - 0.4, FACE.eyeY + 0.25, 0.2, vg, null, 40, 30); vp.renderOrder = 6; vIn.add(vp);
    vIn.add(surfaceRing(0, (FACE.mouthY - 0.4 + FACE.eyeY + 0.25) / 2, halfWidthAt(FACE.eyeY) * 0.98, (FACE.eyeY + 0.25 - FACE.mouthY + 0.4) / 2, 0.2, 0.02, blackMat(), 64));
    let a = 0;
    return { obj: g, update(st) { a += ((st.visorDown ? 0 : -0.95) - a) * Math.min(1, st.dt * 7); const k = -a / 0.95; visor.rotation.x = a; visor.position.set(0, kp + 0.05 * k, -0.4 * k); } };
  } },
  { id: 'ssh68', name: '🪖 SSh-68 Soviet Steel Helmet', build() {
    const g = new THREE.Group(); const green = std(0x4a5236, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.15, eyeTheta + 0.1, eyeTheta + 0.15);
    g.add(cap(1.12, edge, green));
    const flare = capEdge(1.16, edge, 0.045, green); g.add(flare);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.08, 5), std(0xb02020, { roughness: 0.5 })); placeOn(star, 1.125, [0, 0.62, 0.78], 0.005); g.add(star);
    return { obj: g, update() {} };
  } },
  { id: 'ushanka', name: '🧸 Ushanka Fur Hat', build() {
    const g = new THREE.Group(); const fur = std(0x5a4632, { roughness: 1 }), wool = std(0x3c4a3a, { roughness: 1, side: THREE.DoubleSide });
    const th = eyeTheta - 0.35; g.add(shell(1.09, th, wool));
    const brimPts = []; for (let i = 0; i < 64; i++) brimPts.push(outerPoint(dirAt(th, i / 64 * TAU)).multiplyScalar(1.12));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(brimPts, true), 128, 0.11, 12, true), fur));
    const flaps = [];
    for (const sx of [-1, 1]) { const piv = new THREE.Group(); piv.position.copy(outerPoint(dirAt(th, sx > 0 ? 0 : Math.PI)).multiplyScalar(1.13)); g.add(piv); const f = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), fur); f.scale.set(0.35, 1.1, 0.9); f.position.set(sx * 0.03, -0.28, 0); piv.add(f); flaps.push({ piv, sx, s: spring(40, 3) }); }
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.06, 5), std(0xd0a020, { metalness: 0.8, roughness: 0.3 })); placeOn(badge, 1.2, [0, 0.62, 0.78], 0.02); g.add(badge);
    return { obj: g, update(st) { for (const f of flaps) f.piv.rotation.z = f.sx * (0.08 + f.s.step(st.dt, 0, -st.drot.z * 0.08 * f.sx - st.drot.y * 0.04 + st.kick * 0.3 + st.jaw * 0.02)); } };
  } },
  { id: 'tankcap', name: '🎖️ Soviet Tanker Helmet', build() {
    const g = new THREE.Group(); const leather = std(0x2a2620, { roughness: 0.75, side: THREE.DoubleSide });
    const edge = helmetEdge(eyeTheta - 0.3, eyeTheta + 0.35, eyeTheta + 0.3);
    g.add(cap(1.08, edge, leather));
    for (let i = -2; i <= 2; i++) { const pts = []; for (let k = 0; k <= 24; k++) pts.push(outerPoint(dirAt(-0.9 + k / 24 * 1.8, i * 0.32 + 0.0001)).multiplyScalar(1.1)); }
    for (let i = -3; i <= 3; i++) { const pts = []; for (let k = 0; k <= 24; k++) { const th = (k / 24) * (eyeTheta - 0.3); pts.push(outerPoint(dirAt(th, Math.PI / 2 + i * 0.3)).multiplyScalar(1.1)); } g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.045, 8), leather)); }
    for (const sx of [-1, 1]) { const e = cyl(0.15, 0.15, 0.08, leather, g, 20); e.rotation.z = Math.PI / 2; e.position.copy(ringPoint(FACE.eyeY - 0.05, sx * Math.PI / 2, 0.08)); }
    return { obj: g, update() {} };
  } },
  { id: 'bandana', name: '🏴 Bandana Headwrap', build() {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ map: checkTex('#1a1a1a', '#3a3a3a'), roughness: 1, side: THREE.DoubleSide });
    g.add(shell(1.05, eyeTheta - 0.32, mat));
    const knot = new THREE.Group(); knot.position.copy(outerPoint(dirAt(eyeTheta - 0.4, -Math.PI / 2)).multiplyScalar(1.06)); g.add(knot);
    const tails = [0.3, -0.3].map(r => { const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 3), mat); t.position.y = -0.17; t.rotation.z = r; const p = new THREE.Group(); p.add(t); knot.add(p); return p; });
    const sw = spring(40, 3);
    return { obj: g, update(st) { const x = sw.step(st.dt, 0, -st.drot.y * 0.08 + st.kick * 0.3); tails.forEach((p, i) => p.rotation.x = x * (i ? 1 : 0.7)); } };
  } },
  { id: 'backcap', name: '🧢 Backwards Ball Cap', build() {
    const g = new THREE.Group(); const c = std(0x2d3a2a, { roughness: 0.95, side: THREE.DoubleSide });
    const th = eyeTheta - 0.5; g.add(shell(1.06, th, c));
    const e = outerPoint(dirAt(th, -Math.PI / 2)).multiplyScalar(1.06);
    const bill = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32, 0, Math.PI), c); bill.rotation.x = -Math.PI / 2 + 0.15; bill.rotation.z = Math.PI; bill.scale.set(1, 0.85, 1); bill.position.set(0, e.y - 0.02, e.z + 0.08); g.add(bill);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshStandardMaterial({ map: patchTex('MGAS', '#2d3a2a', '#d8c690'), roughness: 0.9 })); placeOn(patch, 1.065, [0, 0.55, 0.83], 0.005); g.add(patch);
    return { obj: g, update() {} };
  } },
];

const TK_FACE = [
  { id: 'ghost', name: '💀 Ghost Skull Balaclava', build() {
    const g = new THREE.Group();
    const skullTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#121212'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8e4d8';
      c.beginPath(); c.ellipse(w / 2, h * 0.22, w * 0.22, h * 0.12, 0, 0, Math.PI); c.fill();          // cheekbones
      for (let i = 0; i < 8; i++) { c.fillRect(w * 0.26 + i * w * 0.061, h * 0.3, w * 0.045, h * 0.2); }   // teeth
      c.fillStyle = '#121212'; c.fillRect(w * 0.24, h * 0.39, w * 0.52, h * 0.02);
      c.fillStyle = '#e8e4d8'; c.beginPath(); c.moveTo(w * 0.22, h * 0.55); c.quadraticCurveTo(w / 2, h * 0.9, w * 0.78, h * 0.55); c.lineTo(w * 0.72, h * 0.5); c.quadraticCurveTo(w / 2, h * 0.78, w * 0.28, h * 0.5); c.fill();
    });
    skullTex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: skullTex, roughness: 1, side: THREE.DoubleSide });
    const xs = halfWidthAt(FACE.mouthY) * 0.98;
    const gy0 = FACE.mouthY - 0.5, gy1 = FACE.eyeY - 0.12;
    const m = surfacePatch(-xs, xs, gy0, gy1, 0.035, mat, (x, y) => { const t = (y - gy0) / (gy1 - gy0); return Math.abs(x) < xs * (0.72 + 0.28 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))))); }, 48, 32);
    g.add(m);
    g.add(band(FACE.mouthY - 0.55, FACE.eyeY - 0.12, 0.03, std(0x121212, { roughness: 1 })));
    return { obj: g, update() {} };
  } },
  { id: 'tagilla', name: '🔨 Welding Mask', build() {
    const g = new THREE.Group(); const red = std(0x7a1a14, { roughness: 0.6 }), metal = steelMat();
    const xs = halfWidthAt(FACE.eyeY) * 0.88;
    g.add(surfacePatch(-xs, xs, FACE.mouthY - 0.4, FACE.eyeY + 0.3, 0.14, red, (x, y) => !(Math.abs(x) < 0.42 && Math.abs(y - FACE.eyeY) < 0.11), 44, 36));
    const lens = new THREE.MeshPhysicalMaterial({ color: 0x0c2a10, transparent: true, opacity: 0.55, roughness: 0.05, clearcoat: 1, envMapIntensity: 2, depthWrite: false });
    const l = surfacePatch(-0.42, 0.42, FACE.eyeY - 0.11, FACE.eyeY + 0.11, 0.15, lens); l.renderOrder = 6; g.add(l);
    g.add(surfaceRing(0, FACE.eyeY, 0.43, 0.115, 0.155, 0.018, metal, 40));
    for (let i = 0; i < 3; i++) { const s = surfaceAt(0, FACE.mouthY - 0.1 - i * 0.08, SMOOTH); const slot = new THREE.Mesh(RBox(0.3, 0.015, 0.02), blackMat()); slot.position.copy(s.p).addScaledVector(s.n, 0.15); slot.quaternion.setFromUnitVectors(Z, s.n); g.add(slot); }
    g.add(loop(FACE.eyeY + 0.25, 0.08, 0.03, blackMat()));
    return { obj: g, update() {} };
  } },
  { id: 'shattered', name: '🛡️ Shattered Armored Mask', build() {
    const g = new THREE.Group(); const m = std(0x2f3234, { roughness: 0.3, metalness: 0.75 });
    const xs = halfWidthAt(FACE.eyeY) * 0.82, ex = FACE.eyeX;
    const sy0 = FACE.mouthY - 0.38, sy1 = FACE.eyeY + 0.28, sm = (sy0 + sy1) / 2, sr = (sy1 - sy0) / 2;
    const keep = (x, y) => Math.hypot(x / xs, (y - sm) / sr) < 1 && Math.hypot((Math.abs(x) - ex) / 0.15, (y - FACE.eyeY) / 0.09) > 1 && !inMouth(x, y + 0.02);
    g.add(surfacePatch(-xs, xs, sy0, sy1, 0.06, m, keep, 56, 44));
    g.add(loop(FACE.eyeY + 0.15, 0.07, 0.025, blackMat()));
    return { obj: g, update() {} };
  } },
  { id: 'respirator', name: '😮‍💨 Half-Face Respirator', build() {
    const g = new THREE.Group(); const grey = std(0x8a8d90, { roughness: 0.5 }), pink = std(0xc75a7a, { roughness: 0.6 });
    const mx = 0.36, keep = (x, y) => Math.hypot(x / mx, (y - (FACE.mouthY - 0.05)) / 0.3) < 1;
    g.add(surfacePatch(-mx, mx, FACE.mouthY - 0.35, FACE.mouthY + 0.25, 0.05, grey, keep, 36, 30));
    for (const sx of [-1, 1]) { const s = surfaceAt(sx * 0.28, FACE.mouthY - 0.1, SMOOTH); const f = cyl(0.12, 0.12, 0.09, pink, g, 24); f.position.copy(s.p).addScaledVector(s.n, 0.12); f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.n.clone().add(new THREE.Vector3(sx * 0.6, 0, 0)).normalize()); }
    g.add(loop(FACE.mouthY + 0.05, 0.05, 0.018, blackMat())); g.add(loop(FACE.eyeY + 0.2, 0.05, 0.018, blackMat()));
    return { obj: g, update() {} };
  } },
  { id: 'balaclava', name: '🥷 Balaclava', build() {
    const g = new THREE.Group(); const knit = new THREE.MeshStandardMaterial({ map: knitTex('#1a1a1c'), roughness: 1, side: THREE.DoubleSide });
    const keepEyes = (p, az) => { if (Math.abs(az) > 0.9) return true; const eyes = Math.abs(p.y - FACE.eyeY) < 0.14 && Math.abs(p.x) < 0.5; const mouth = inMouth(p.x, p.y); return !eyes && !mouth; };
    g.add(hairBase((p, az) => p.y > FACE.mouthY - 0.6 && keepEyes(p, az), '#1a1a1c', 1.018));
    const m = g.children[0]; m.material = knit;
    return { obj: g, update() {} };
  } },
];

const TK_EYES = [
  { id: 'thermal', name: '🔴 T-7 Thermal Goggles (G)', build() {
    const g = new THREE.Group(); const dark = blackMat({ metalness: 0.3 });
    g.add(ring(1.11, eyeTheta * 0.55, 0.035, std(0x1d1d18, { roughness: 0.9 })));
    const my = FACE.eyeY + 0.5, mount = new THREE.Group(); mount.position.set(0, my, frontZ(my) + 0.06); g.add(mount);
    box(0.2, 0.12, 0.09, dark, 0, 0, 0, mount);
    const dy = FACE.eyeY - my, dz = frontZ(FACE.eyeY) + 0.3 - mount.position.z;
    box(0.09, Math.abs(dy) + 0.05, 0.07, dark, 0, dy / 2, dz * 0.45, mount);
    box(0.7, 0.2, 0.24, dark, 0, dy, dz - 0.05, mount);
    const lens = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3020, emissiveIntensity: 0.2, roughness: 0.2 });
    for (const x of [-0.17, 0.17]) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), lens); l.position.set(x, dy, dz + 0.071); mount.add(l); }
    let a = -1.25;
    return { obj: g, update(st) { a += ((st.nvgDown ? 0 : -1.25) - a) * Math.min(1, st.dt * 6); mount.rotation.x = a; lens.emissiveIntensity = st.nvgDown ? 1.4 + Math.sin(st.t * 6) * 0.3 : 0.15; } };
  } },
  { id: 'crossbow', name: '🟠 Orange Tactical Glasses', build() {
    const g = new THREE.Group(); const frame = blackMat({ roughness: 0.4 });
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xff8a20, transparent: true, opacity: 0.6, roughness: 0.02, clearcoat: 1, metalness: 0.4, envMapIntensity: 2, depthWrite: false });
    const w = FACE.eyeX + 0.2;
    const l = surfacePatch(-w, w, FACE.eyeY - 0.11, FACE.eyeY + 0.1, 0.07, lens, (x, y) => !(Math.abs(x) < 0.05 && y < FACE.eyeY - 0.03)); l.renderOrder = 6; g.add(l);
    g.add(surfaceRing(0, FACE.eyeY + 0.1, w, 0.004, 0.075, 0.02, frame, 40));
    g.add(loop(FACE.eyeY + 0.06, 0.05, 0.015, frame));
    return { obj: g, update() {} };
  } },
];

const TK_EARS = [
  { id: 'sordin', name: '🟩 MSA Sordin Headset', build: () => headset2({ shellColor: 0x4a5a32, capColor: 0x3a4628 }) },
  { id: 'gssh', name: '☭ GSSh-01 Headset', build: () => headset2({ shellColor: 0x2a2a28, capColor: 0x3a3a36, mic: false, cable: true }) },
  { id: 'razor', name: '🎧 Walker\'s Razor (slim)', build: () => headset2({ shellColor: 0x5a5a32, capColor: 0x222222, slim: true, mic: false }) },
  { id: 'comtac4', name: '🟫 ComTac IV (coyote)', build: () => headset2({ shellColor: 0x8a7350, capColor: 0x5e4e36 }) },
];

const TK_BODY = [
  { id: 'slick', name: '⬛ LBT Slick Plate Carrier', build: () => armor({ color: 0x232426, mags: 3, patch: ['USEC', '#232426', '#c8c8c8'] }) },
  { id: 'slicktan', name: '🟫 Slick Carrier (tan)', build: () => armor({ tex: tanTex, mags: 3, admin: true, patch: ['TATER', '#8a7350', '#2a2418'] }) },
  { id: 'thor', name: '🛡️ Thor Heavy Armor', build: () => armor({ color: 0x3d4244, collar: true, shoulders: true, mags: 2, bulk: 0.14, low: -1.25, high: -0.32, patch: ['THOR', '#2d3234', '#9aa0a2'] }) },
  { id: 'gzhel', name: '🇷🇺 Gzhel-K Body Armor', build: () => armor({ tex: flora, collar: true, mags: 0, bulk: 0.13, low: -1.25, high: -0.35, patch: ['BEAR', '#4a5a32', '#e0d8a0'] }) },
  { id: 'jpc', name: '🎯 JPC + Mags (multicam)', build: () => armor({ tex: multicamTex, mags: 3, pistolMag: true, admin: true, patch: ['MGAS', '#6f6a44', '#e8dcb0'] }) },
  { id: 'atacs', name: '🌫️ A-TACS Plate Carrier', build: () => armor({ tex: atacsTex, mags: 4, patch: ['USEC', '#5d5a4c', '#e8e4d0'] }) },
];

const TK_NECK = [
  { id: 'gaiter', name: '🧣 Camo Neck Gaiter', build() { const g = new THREE.Group(); g.add(band(-0.6, -0.32, 0.07, new THREE.MeshStandardMaterial({ map: multicamTex(), roughness: 1, side: THREE.DoubleSide }))); return { obj: g, update() {} }; } },
];

const TK_BACK = [
  { id: 'ak', name: '🔫 AK-74 Slung on Back', build: () => slungGun(akRifle, 1) },
  { id: 'm4', name: '🔫 M4A1 Slung on Back', build: () => slungGun(m4Rifle, -1) },
  { id: 'pilgrim', name: '🎒 Pilgrim Backpack + Bedroll', build: () => backpack({ color: 0x4a5a3a, w: 0.8, h: 0.95, d: 0.42, bedroll: true, frame: true }) },
  { id: 'blackjack', name: '🎒 Blackjack 50 (black)', build: () => backpack({ color: 0x1f2022, w: 0.72, h: 0.88, d: 0.4 }) },
  { id: 'trizip', name: '🎒 Tri-Zip Pack (tan)', build: () => backpack({ tex: tanTex, w: 0.68, h: 0.8, d: 0.36 }) },
  { id: 'scav', name: '👜 Scav Sling Bag', build: () => backpack({ tex: () => checkTex('#5a4a3a', '#4a3a2a'), w: 0.5, h: 0.5, d: 0.25 }) },
];


// ======================= HAIR v2: layered fur shells =======================
// Dozens of stacked layers, each showing only the strands still "alive" at that height,
// darker at the roots and sagging with gravity. Reads as soft, dense hair instead of spikes.
let STRAND_TEX = null, STRAND_COL = null;
function strandTexture() {
  if (STRAND_TEX) return STRAND_TEX;
  // dense grid of tapered strands: every cell holds one hair with a random length (brightness),
  // jittered so it never looks like a grid
  const N = 512, CELL = 5;
  STRAND_TEX = canvasTex(N, N, (c, w, h) => {
    const img = c.createImageData(w, h), cells = Math.floor(w / CELL);
    const H = new Float32Array(cells * cells), JX = new Float32Array(cells * cells), JY = new Float32Array(cells * cells), R = new Float32Array(cells * cells);
    for (let i = 0; i < H.length; i++) { H[i] = 0.15 + 0.85 * Math.pow(rnd(), 0.7); JX[i] = (rnd() - 0.5) * 0.6; JY[i] = (rnd() - 0.5) * 0.6; R[i] = 0.42 + rnd() * 0.25; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cx = x / CELL, cy = y / CELL, ix = Math.floor(cx), iy = Math.floor(cy); let best = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = (ix + ox + cells) % cells, gy = (iy + oy + cells) % cells, k = gy * cells + gx;
        const px = ix + ox + 0.5 + JX[k], py = iy + oy + 0.5 + JY[k], d = Math.hypot(cx - px, cy - py) / R[k];
        if (d < 1) best = Math.max(best, H[k] * (1 - d * d));
      }
      const o = (y * w + x) * 4, v = Math.round(best * 255); img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    // color: each strand a slightly different shade, with a lighter core
    STRAND_COL = canvasTex(w, h, (c2) => {
      const im2 = c2.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ix = Math.floor(x / CELL) % cells, iy = Math.floor(y / CELL) % cells, k = iy * cells + ix, o = (y * w + x) * 4;
        const shade = 0.62 + 0.38 * ((H[k] * 7.31) % 1), core = img.data[o] / 255;
        const v = Math.round(255 * Math.min(1, shade * (0.8 + 0.3 * core)));
        im2.data[o] = v; im2.data[o + 1] = v; im2.data[o + 2] = Math.round(v * 0.97); im2.data[o + 3] = 255;
      }
      c2.putImageData(im2, 0, 0);
    });
    STRAND_COL.userData.shared = true;
  });
  STRAND_TEX.colorSpace = THREE.NoColorSpace; STRAND_TEX.wrapS = STRAND_TEX.wrapT = THREE.RepeatWrapping;
  STRAND_TEX.userData.shared = true;
  return STRAND_TEX;
}
const sstep = (a, b, x) => smooth(a, b, x);
// field(p, az) -> { m: 0..1 coverage, len: hair length } ; region = which part of the head to grid over
function furShells({ field, palette, layers = 28, droop = 0.6, comb = null, density = 46, puff = 0.6, clump = 0.35, phiRange = [Math.PI / 2 - 2.3, Math.PI / 2 + 2.3], thetaRange = [0, Math.PI], res = [150, 110], lift = 0.004 }) {
  const [nu, nv] = res, tex = strandTexture();
  const base = [], nrm = [], mask = [], lens = [], uvs = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const phi = phiRange[0] + (phiRange[1] - phiRange[0]) * i / nu, th = thetaRange[0] + (thetaRange[1] - thetaRange[0]) * j / nv;
    const d = dirAt(th, phi), p = outerPoint(d), n = shapeNormal(d, SMOOTH), az = Math.atan2(p.x, p.z);
    const f = field(p, az) || { m: 0, len: 0 };
    base.push(p); nrm.push(n); mask.push(f.m); lens.push(f.len || 0);
    uvs.push(phi * 0.42 * density / 10, (Math.cos(th)) * 0.55 * density / 10);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + nu + 1;
    if (Math.max(mask[a], mask[a + 1], mask[b], mask[b + 1]) <= 0.001) continue;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.Group(), meshes = [];
  const root = new THREE.Color(palette[0]).multiplyScalar(0.45), tip = new THREE.Color(palette[palette.length - 1]);
  const down = new THREE.Vector3(0, -1, 0), tmp = new THREE.Vector3(), c = new THREE.Color();
  for (let L = 0; L < layers; L++) {
    const t = (L + 1) / layers, pos = new Float32Array(base.length * 3), col = new Float32Array(base.length * 4);
    for (let k = 0; k < base.length; k++) {
      const len = lens[k] * mask[k] ** 0.5, n = nrm[k];
      tmp.copy(base[k]).addScaledVector(n, lift + len * t * puff);
      const dir = comb ? comb(base[k], n) : down;
      tmp.addScaledVector(dir, Math.min(len * droop * t * t, 0.2 + len * 0.5));
      if (clump) {   // hair gathers into loose locks and waves instead of a perfect sheet
        const b = base[k], q = clump * len * t;
        tmp.x += (vnoise(b.x * 7 + 1, b.y * 7, b.z * 7) - 0.5) * q + (vnoise(b.x * 19 + 4, b.y * 19, b.z * 19) - 0.5) * q * 0.4;
        tmp.y += (vnoise(b.x * 7 + 9, b.y * 7, b.z * 7) - 0.5) * q * 0.6;
        tmp.z += (vnoise(b.x * 7 + 17, b.y * 7, b.z * 7) - 0.5) * q;
      }
      pos[k * 3] = tmp.x; pos[k * 3 + 1] = tmp.y; pos[k * 3 + 2] = tmp.z;
      c.copy(root).lerp(tip, Math.pow(t, 0.8));
      col[k * 4] = c.r; col[k * 4 + 1] = c.g; col[k * 4 + 2] = c.b; col[k * 4 + 3] = Math.min(1, mask[k] * 1.6) * (L === 0 ? 1 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: STRAND_COL, alphaMap: L === 0 ? null : tex, alphaTest: L === 0 ? 0.5 : Math.min(0.97, 0.08 + Math.pow(t, 1.05) * 0.9), roughness: 0.62, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; g.add(m); meshes.push(m);
  }
  return { group: g, meshes };
}
// smooth coverage helpers
const soft = (v, edge = 0.04) => sstep(-edge, edge, v);   // v > 0 inside
const mouthHole = (x, y) => Math.hypot(x / (MOUTH.rx + 0.02), (y - FACE.mouthY) / (MOUTH.ry + 0.02)) - 1;
function beardField({ len, under = 0, chinY = FACE.mouthY - 0.62, stache = true, sides = true }) {
  return (p, az) => {
    const A = Math.abs(az); if (A > 2.15) return null;
    const u = Math.abs(p.x), side = sstep(0.55, 1.5, A);
    // top edge: sideburns at the sides, a dip under the cheeks, the mustache line in the middle
    const top = lerpN(u < 0.33 ? FACE.mouthY + 0.2 - 0.05 * sstep(0, 0.33, u) : FACE.mouthY + 0.09, FACE.eyeY - 0.02, sides ? side : 0) + jag(p.x, p.y, 0.02);
    let m = soft(top - p.y, 0.035) * soft(mouthHole(p.x, p.y), 0.04);
    if (!stache && p.y > FACE.mouthY && u < 0.35) m *= soft(-(p.y - FACE.mouthY - 0.02), 0.03);
    if (!sides) m *= soft(2.1 - A - 0.5, 0.1);
    m *= soft(p.y - (chinY - 0.4), 0.05);
    if (m <= 0.001) return null;
    return { m, len: len(p, az) };
  };
}
function beardItem(id, name, pal, opts) {
  return { id, name, build() {
    const g = new THREE.Group(), sway = new THREE.Group(); sway.position.set(0, FACE.mouthY, 0.3); g.add(sway);
    const fur = furShells({ field: beardField(opts), palette: HAIR[pal], layers: opts.layers || 30, droop: opts.droop ?? 0.9, density: opts.density || 50, puff: opts.puff ?? 0.8, clump: opts.clump ?? 0.45,
      phiRange: [Math.PI / 2 - 2.2, Math.PI / 2 + 2.2], thetaRange: [Math.acos(Math.min(1, (FACE.eyeY + 0.05) / TOP)), Math.PI * 0.97],
      comb: (b, n) => tmpV.set(0, -1, 0).addScaledVector(n, opts.forward ?? 0.35).normalize() });
    fur.group.position.set(0, -FACE.mouthY, -0.3); sway.add(fur.group);
    const sx = spring(35, 4), sz = spring(35, 4); let pj = 0;
    return { obj: g, update(st) {
      sway.rotation.x = sx.step(st.dt, 0, -st.drot.x * 0.012 + (st.jaw - pj) * 0.5 + st.kick * 0.05);
      sway.rotation.z = sz.step(st.dt, 0, -st.drot.z * 0.012 - st.drot.y * 0.006); pj = st.jaw;
    } };
  } };
}
const tmpV = new THREE.Vector3();
const chinGrow = (start, full, extra) => (p) => start + extra * sstep(FACE.mouthY - 0.02, FACE.mouthY - full, p.y);
const BEARDS2 = [
  beardItem('hutch', '🧔‍♂️ The Hutch (big full beard)', 'brown', { len: (p, az) => chinGrow(0.13, 0.42, 0.42)(p) * (1 - 0.2 * sstep(0.9, 1.9, Math.abs(az))), droop: 1.0, forward: 0.6, puff: 1.2, clump: 0.6, layers: 40 }),
  beardItem('fullbeard', '🧔 Full Beard', 'brown', { len: (p) => chinGrow(0.09, 0.4, 0.18)(p), droop: 0.8 }),
  beardItem('lumberjack', '🪓 Lumberjack Beard (ginger)', 'ginger', { len: (p) => chinGrow(0.12, 0.45, 0.3)(p), droop: 1.0, forward: 0.4 }),
  beardItem('wizard', '🧙 Long Grey Beard', 'grey', { len: (p) => chinGrow(0.1, 0.4, 0.75)(p), droop: 1.7, forward: 0.25, layers: 40 }),
  beardItem('blackbeard', '🏴‍☠️ Black Beard', 'black', { len: (p) => chinGrow(0.1, 0.4, 0.38)(p), droop: 1.1, forward: 0.4 }),
  beardItem('stubble', '🪒 Stubble', 'black', { len: () => 0.025, droop: 0.1, layers: 10, density: 80 }),
  { id: 'goatee', name: '🐐 Goatee', build() {
    const field = (p, az) => { if (Math.abs(az) > 0.9) return null; const u = Math.abs(p.x) + jag(p.x, p.y, 0.015), w = p.y - FACE.mouthY;
      const stache = soft(0.27 - 0.08 * sstep(0.08, 0.19, w) - u, 0.025) * soft(w - 0.08, 0.02) * soft(0.2 - w, 0.02);
      const chin = soft(0.24 * Math.sqrt(Math.max(0, 1 - ((w + 0.18) / 0.32) ** 2)) - u, 0.025) * soft(0.02 - w, 0.02);
      const link = soft(u - 0.19, 0.015) * soft(0.27 - u, 0.015) * soft(0.09 - w, 0.02) * soft(w, 0.02);
      const m = Math.max(stache, chin, link) * soft(mouthHole(p.x, p.y), 0.03); return m > 0.001 ? { m, len: 0.06 + 0.12 * sstep(FACE.mouthY - 0.08, FACE.mouthY - 0.45, p.y) } : null; };
    const fur = furShells({ field, palette: HAIR.brown, layers: 26, droop: 0.9, phiRange: [Math.PI / 2 - 1, Math.PI / 2 + 1], thetaRange: [Math.acos((FACE.mouthY + 0.25) / TOP), Math.acos((FACE.mouthY - 0.6) / TOP)], res: [80, 60] });
    return { obj: fur.group, update() {} };
  } },
];
function stacheItem(id, name, pal, shape, { len = 0.07, tips = false, droop = 0.6 } = {}) {
  return { id, name, build() {
    const field = (p, az) => { if (Math.abs(az) > 1) return null; const w = p.y - FACE.mouthY; const m = shape(p.x + jag(p.x, p.y, 0.01), w) * (w > 0.075 || Math.abs(p.x) > 0.22 ? 1 : soft(mouthHole(p.x, p.y), 0.02)); return m > 0.001 ? { m, len } : null; };
    const fur = furShells({ field, palette: HAIR[pal], layers: 22, droop, density: 60, phiRange: [Math.PI / 2 - 0.9, Math.PI / 2 + 0.9], thetaRange: [Math.acos((FACE.mouthY + 0.32) / TOP), Math.acos((FACE.mouthY - 0.5) / TOP)], res: [90, 70],
      comb: (b, n) => tmpV.set(Math.sign(b.x) * 0.7, -1, 0).addScaledVector(n, 0.2).normalize() });
    const g = new THREE.Group(); g.add(fur.group);
    if (tips) for (const sx of [-1, 1]) g.add(stacheTip(sx, HAIR[pal], 3.6));
    const tw = spring(120, 7); let pj = 0;
    return { obj: g, update(st) { const x = tw.step(st.dt, 0, (st.jaw - pj) * 2); pj = st.jaw; g.position.y = x * 0.02; g.scale.x = 1 + x * 0.05; } };
  } };
}
const STACHES2 = [
  stacheItem('chevron', '🥸 Chevron', 'brown', (u, w) => soft(0.3 - 0.07 * sstep(0.09, 0.21, w) - Math.abs(u), 0.03) * soft(w - 0.085, 0.02) * soft(0.215 - w, 0.02), { len: 0.08 }),
  stacheItem('pencil', '✏️ Pencil Mustache', 'black', (u, w) => soft(0.25 - Math.abs(u), 0.02) * soft(Math.abs(u) - 0.02, 0.01) * soft(w - 0.1, 0.012) * soft(0.135 - w, 0.012), { len: 0.03, droop: 0.2 }),
  stacheItem('horseshoe', '🐴 Horseshoe', 'blonde', (u, w) => { const a = Math.abs(u); const top = soft(0.3 - a, 0.025) * soft(w - 0.09, 0.02) * soft(0.2 - w, 0.02); const bars = soft(a - 0.23, 0.02) * soft(0.32 - a, 0.02) * soft(w + 0.42, 0.03) * soft(0.2 - w, 0.02); return Math.max(top, bars); }, { len: 0.08 }),
  stacheItem('handlebar', '🎩 Handlebar', 'brown', (u, w) => soft(0.24 - Math.abs(u), 0.025) * soft(w - 0.095, 0.02) * soft(0.18 - 0.04 * Math.abs(u) / 0.24 - w, 0.02), { len: 0.07, tips: true }),
  stacheItem('walrus', '🦭 Walrus', 'grey', (u, w) => soft(0.34 - 0.06 * sstep(0.06, 0.24, w) - Math.abs(u), 0.03) * soft(w - 0.05, 0.02) * soft(0.245 - w, 0.02), { len: 0.16, droop: 1.1 }),
];
function mullet2(pal, { length = 0.75, curly = 0, rattail = false } = {}) {
  const palette = HAIR[pal], hairline = FACE.eyeY + 0.32;
  const field = (p, az) => {
    const A = Math.abs(az), u = Math.abs(p.x);
    const line = hairline - 0.1 * (u / 0.6) ** 2 + 0.06 * Math.exp(-(((u - 0.38) / 0.1) ** 2)) + jag(p.x, p.y, 0.02);
    const frontM = soft(p.y - line, 0.03);
    const sideM = soft(p.y - (FACE.eyeY + 0.05), 0.04);                 // short above the ears
    const backM = soft(p.y - (FACE.mouthY - 0.2), 0.05);                // long down the back
    const wF = 1 - sstep(0.9, 1.3, A), wB = sstep(1.7, 2.2, A), wS = 1 - wF - wB;
    const m = frontM * wF + sideM * Math.max(0, wS) + backM * wB;
    if (m <= 0.001) return null;
    const len = 0.13 + 0.07 * curly + wB * length * (0.4 + 0.6 * sstep(FACE.eyeY + 0.1, FACE.mouthY - 0.1, p.y));
    return { m: Math.min(1, m), len };
  };
  const fur = furShells({ field, palette, layers: 34, droop: 1.0, density: 44, res: [180, 120], puff: 0.9, clump: 0.7 + curly * 0.6, phiRange: [-Math.PI, Math.PI], thetaRange: [0, Math.acos((FACE.mouthY - 0.3) / TOP)],
    comb: (b, n) => { const back = tmpV.set(0, 0.15, -1); back.addScaledVector(n, -n.dot(back)); if (b.z < -0.2 && b.y < FACE.eyeY + 0.2) back.set(0, -1, -0.15); return back.normalize(); } });
  const g = new THREE.Group(); g.add(fur.group);
  if (rattail) {
    const pts = []; for (let i = 0; i <= 10; i++) pts.push(ringPoint(FACE.mouthY - 0.15 - i * 0.09, Math.PI, 0.03 + i * 0.012));
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 8); g.add(new THREE.Mesh(geo, std(new THREE.Color(palette[0]), { roughness: 0.6 })));
  }
  const sx = spring(22, 2.6), sz = spring(22, 2.6);
  return { obj: g, update(st) { const x = sx.step(st.dt, 0, -st.drot.x * 0.03 + st.kick * 0.25), z = sz.step(st.dt, 0, -st.drot.z * 0.03 - st.drot.y * 0.015);
    fur.meshes.forEach((m, i) => { const t = i / fur.meshes.length; m.rotation.x = x * 0.06 * t * t; m.rotation.z = z * 0.06 * t * t; }); } };
}
const HAIRDOS2 = [
  { id: 'mullet', name: '🦅 Classic Mullet', build: () => mullet2('brown') },
  { id: 'mullet80s', name: '🎸 80s Blonde Mullet', build: () => mullet2('blonde', { curly: 1, length: 0.85 }) },
  { id: 'gingermullet', name: '🔥 Ginger Mullet', build: () => mullet2('ginger', { length: 0.7 }) },
  { id: 'joedirt', name: '🧢 Dirty Mullet + Rat Tail', build: () => mullet2('dirty', { length: 0.55, rattail: true }) },
  { id: 'blackmullet', name: '🖤 Black Mullet', build: () => mullet2('black', { length: 0.9 }) },
  { id: 'buzz', name: '💈 Buzz Cut', build: () => { const hairline = FACE.eyeY + 0.3; const f = furShells({ field: (p, az) => { const A = Math.abs(az); const m = A < 1.2 ? soft(p.y - hairline + 0.08 * (Math.abs(p.x) / 0.6) ** 2, 0.03) : soft(p.y - (FACE.eyeY - 0.05), 0.04); return m > 0.001 ? { m, len: 0.03 } : null; }, palette: HAIR.brown, layers: 12, droop: 0.1, density: 80, res: [160, 90], phiRange: [-Math.PI, Math.PI], thetaRange: [0, Math.acos((FACE.eyeY - 0.2) / TOP)] }); return { obj: f.group, update() {} }; } },
];

// ======================= LOGO GEAR =======================
// Pictures you upload in the wardrobe replace the built-in designs.
export const CUSTOM = { cap: null, can: null };
const CAN_TINTS = ['#7fd6c4', '#7fb7e8', '#9fe07a', '#e8c46a', '#e88a8a', '#b79be8'];
function canLidTexture(tint) {
  return canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#121314'; c.fillRect(0, 0, w, h);
    if (CUSTOM.can) { c.save(); c.beginPath(); c.arc(w / 2, h / 2, w * 0.47, 0, TAU); c.clip(); const im = CUSTOM.can, s = Math.max(w / im.width, h / im.height); c.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s); c.restore(); return; }
    // built-in design: a tater-themed tin
    c.fillStyle = '#f4f2ec'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.42, 0, TAU); c.fill();
    const gr = c.createLinearGradient(0, h * 0.12, 0, h * 0.42); gr.addColorStop(0, tint); gr.addColorStop(1, '#f4f2ec');
    c.fillStyle = gr; c.beginPath(); c.arc(w / 2, h / 2, w * 0.42, Math.PI * 1.08, Math.PI * 1.92); c.fill();
    c.fillStyle = '#121314'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 30px Arial Black, Impact, sans-serif'; c.fillText('TATER', w / 2, h * 0.47);
    c.font = 'bold 15px Arial, sans-serif'; c.fillText('POUCHES', w / 2, h * 0.6);
    c.fillStyle = '#121314'; c.fillRect(w * 0.18, h * 0.68, w * 0.64, h * 0.12);
    c.fillStyle = '#f4f2ec'; c.font = 'bold 11px Arial, sans-serif'; c.fillText('20 PER TIN', w / 2, h * 0.74);
  });
}
function capLogoTexture() {
  return canvasTex(512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    if (CUSTOM.cap) { const im = CUSTOM.cap, s = Math.min(w / im.width, h / im.height) * 0.95; c.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s); return; }
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 120px Arial Black, Impact, sans-serif'; c.fillText('MGAS', w / 2, h / 2 + 6);
  });
}
const LOGO_HEAD = [
  { id: 'blackcap', name: '🧢 Black Cap (your logo)', build() {
    const g = new THREE.Group(); const blk = std(0x151617, { roughness: 0.9, side: THREE.DoubleSide });
    const K = 1.07, th = eyeTheta - 0.3; g.add(shell(K, th, blk));
    for (let i = 0; i < 6; i++) { const pts = []; for (let k = 0; k <= 16; k++) pts.push(outerPoint(dirAt(k / 16 * th, i / 6 * TAU + Math.PI / 6)).multiplyScalar(K + 0.005)); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.008, 5), std(0x0a0a0a, { roughness: 1 }))); }
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), blk); btn.position.y = TOP * K; btn.scale.y = 0.5; g.add(btn);
    g.add(ring(K + 0.002, th, 0.012, std(0x101010, { roughness: 1 })));
    // bill: built out of the crown's own front edge so it always fits, with real thickness
    const e = outerPoint(dirAt(th, Math.PI / 2)).multiplyScalar(K);
    const billMat = std(0x18191a, { roughness: 0.88, side: THREE.DoubleSide }), underMat = std(0x232624, { roughness: 0.95, side: THREE.DoubleSide });
    const span = 1.2, NU = 40, NV = 8, T = 0.028;
    const top = [], bot = [];
    for (let i = 0; i <= NU; i++) {
      const rel = (i / NU) * 2 - 1, phi = Math.PI / 2 + rel * span;
      const inner = outerPoint(dirAt(th, phi)).multiplyScalar(K * 0.998);
      const horiz = new THREE.Vector3(inner.x, 0, inner.z).normalize();
      const dir = horiz.clone().lerp(new THREE.Vector3(0, 0, 1), 0.55).normalize();
      const L = 0.6 * Math.pow(Math.cos(rel * Math.PI / 2), 0.55);          // longest in the middle, tapering into the sides
      const rowT = [], rowB = [];
      for (let j = 0; j <= NV; j++) {
        const t = j / NV, q = inner.clone().addScaledVector(dir, L * t);
        q.y += -0.16 * t * L - 0.1 * rel * rel * t;                          // dips a little forward and curves down at the sides
        rowT.push(q); rowB.push(q.clone().add(new THREE.Vector3(0, -T, 0)));
      }
      top.push(rowT); bot.push(rowB);
    }
    const mkSurface = (grid, flip) => {
      const pos = [], idx = [], uv = [];
      grid.forEach((row, i) => row.forEach((q, j) => { pos.push(q.x, q.y, q.z); uv.push(i / NU * 4, j / NV); }));
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a2 = i * (NV + 1) + j, b2 = a2 + NV + 1; flip ? idx.push(a2, a2 + 1, b2, b2, a2 + 1, b2 + 1) : idx.push(a2, b2, a2 + 1, b2, b2 + 1, a2 + 1); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals(); return gg;
    };
    g.add(new THREE.Mesh(mkSurface(top, false), billMat));
    g.add(new THREE.Mesh(mkSurface(bot, true), underMat));
    // rounded outer rim joining top and bottom, plus a row of stitching on top
    const rimPts = top.map(row => row[NV].clone().add(new THREE.Vector3(0, -T / 2, 0)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 80, T / 2, 8), billMat));
    for (let k = 1; k <= 3; k++) {
      const st = top.map(row => { const q = row[Math.round(NV * (1 - k * 0.12))].clone(); q.y += 0.004; return q; });
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(st), 80, 0.0035, 4), std(0x2c2d2e, { roughness: 1 })));
    }
    // logo on the front panel, sitting on the crown and bent to its curve
    const fy = e.y + (TOP * K - e.y) * 0.38;
    const s0 = surfaceAt(0, fy / K, SMOOTH), fp = s0.p.multiplyScalar(K), fn = s0.n;
    const logoGeo = new THREE.PlaneGeometry(0.6, 0.3, 24, 6), lp = logoGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) { const x = lp.getX(i); lp.setZ(i, -0.75 * x * x); }
    logoGeo.computeVertexNormals();
    const logo = new THREE.Mesh(logoGeo, new THREE.MeshStandardMaterial({ map: capLogoTexture(), transparent: true, alphaTest: 0.05, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    logo.position.copy(fp).addScaledVector(fn, 0.03); logo.quaternion.setFromUnitVectors(Z, fn); g.add(logo);
    return { obj: g, update() {} };
  } },
];
const LOGO_BELT = [
  { id: 'pouchbelt', name: '🥫 Pouch Tin Ammo Belt', build() {
    const g = new THREE.Group(), y = -0.86;
    const nylon = std(0x1d1e1c, { roughness: 0.95 }), metal = std(0x9a9ea2, { metalness: 0.9, roughness: 0.3 });
    g.add(band(y - 0.09, y + 0.09, 0.05, nylon));
    const buckle = box(0.24, 0.17, 0.04, metal, 0, y, ringPoint(y, 0, 0.08).z, g);
    const tins = [], N = 10;
    for (let i = 0; i < N; i++) {
      const a = (i - (N - 1) / 2) * 0.36; if (Math.abs(a) < 0.2) continue;       // gap at the buckle
      const p = ringPoint(y, a, 0.1), out = new THREE.Vector3(p.x, 0, p.z).normalize();
      const holder = new THREE.Group(); holder.position.copy(p); holder.lookAt(p.clone().add(out)); g.add(holder);
      const clip = box(0.3, 0.34, 0.02, nylon, 0, 0.02, -0.03, holder);          // the belt loop it hangs from
      const strap = box(0.06, 0.36, 0.025, nylon, 0, 0.02, 0.06, holder);         // retaining strap across the tin
      const tin = new THREE.Group(); tin.position.set(0, -0.01, 0.02); holder.add(tin);
      const lidMat = new THREE.MeshStandardMaterial({ map: canLidTexture(CAN_TINTS[i % CAN_TINTS.length]), roughness: 0.45 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.065, 40), [std(0x151617, { roughness: 0.4 }), lidMat, std(0x151617)]);
      body.rotation.x = Math.PI / 2; tin.add(body);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.143, 0.009, 6, 40), std(0x0d0d0d, { roughness: 0.3 })); rim.position.z = 0.033; tin.add(rim);
      tins.push({ tin, s: spring(90, 6), i });
    }
    return { obj: g, update(st) { for (const t of tins) t.tin.rotation.x = t.s.step(st.dt, 0, -st.drot.x * 0.02 + st.kick * (0.2 + 0.05 * (t.i % 3))); } };
  } },
];

// ======================= DOWNLOADED MODELS (Fab, CC BY 4.0) =======================
// Real artist-made models, shrunk for live use and fitted onto the potato here.
export const CREDITS = [
  ['AKM Assault Rifle 3D model realistic', 'Ag72', 'https://www.fab.com/listings/54921e31-5077-4ad8-9d5a-7b8bdd6ac7d3'],
  ['Classic M4', 'SpatialNeglect', 'https://www.fab.com/listings/0fb6a75a-75aa-4ffd-b9e4-6f292f7a410a'],
  ['Bucket Hat', 'Tiko', 'https://www.fab.com/listings/50a8d899-e55d-430d-b6ac-47d681cbd34d'],
  ['Worn Crew Hat', 'Kami Rapacz', 'https://www.fab.com/listings/05e5fa4f-6af7-44c3-bbab-12b9b257e8f0'],
  ['Headphone', 'Gabriel Quintana', 'https://www.fab.com/listings/c1962a4b-0aae-4a6b-a724-f7e969d3fd72'],
  ['Black Sunglasses', 'DeepDown', 'https://www.fab.com/listings/38836718-e679-4e2e-974f-0005221616cd'],
  ['body armor flak jacket (remaster)', 'marko1937', 'https://www.fab.com/listings/7f8dfc3f-4915-462b-90d6-d28d75eed5a1'],
  ['military balaclava and headset (remaster)', 'marko1937', 'https://www.fab.com/listings/cf2ad803-12ff-4be0-937e-8602ad105d21'],
];
const GLB_CACHE = {};
const gltfLoader = new GLTFLoader();
function loadGLB(file) {
  if (!GLB_CACHE[file]) GLB_CACHE[file] = gltfLoader.loadAsync(new URL('./assets/gear/' + file, import.meta.url).href).then(g => g.scene);
  return GLB_CACHE[file];
}
function meshCenter(o) { const b = new THREE.Box3().setFromObject(o); return b.getCenter(new THREE.Vector3()); }
// fit: { keep(mesh), rot:[x,y,z], width|length|height, yScale, top|centerY|bottom, front|back|centerZ, x, recolor(mat, mesh) }
function glbItem(id, name, file, fit, extra) {
  return { id, name, build() {
    const g = new THREE.Group(), pivot = new THREE.Group(); g.add(pivot);
    let ready = false, onReady = [];
    loadGLB(file).then(src => {
      const model = src.clone(true); model.updateMatrixWorld(true);
      if (fit.keep) { const drop = []; model.traverse(o => { if (o.isMesh && !fit.keep(o, meshCenter(o))) drop.push(o); }); drop.forEach(o => o.parent.remove(o)); }
      model.traverse(o => { if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        if (fit.recolor) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => fit.recolor(m, o));
        o.frustumCulled = false;
      } });
      const inner = new THREE.Group(); inner.add(model); inner.rotation.set(...(fit.rot || [0, 0, 0])); pivot.add(inner);
      pivot.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(inner); const size = box.getSize(new THREE.Vector3());
      const k = fit.width ? fit.width / size.x : fit.length ? fit.length / Math.max(size.x, size.z) : fit.height / size.y;
      inner.scale.multiply(new THREE.Vector3(k, k * (fit.yScale || 1), k));
      pivot.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(inner);
      const c = box.getCenter(new THREE.Vector3()), off = new THREE.Vector3((fit.x ?? 0) - c.x, 0, 0);
      off.y = fit.top !== undefined ? fit.top - box.max.y : fit.bottom !== undefined ? fit.bottom - box.min.y : (fit.centerY ?? 0) - c.y;
      off.z = fit.front !== undefined ? fit.front - box.max.z : fit.back !== undefined ? fit.back - box.min.z : (fit.centerZ ?? 0) - c.z;
      inner.position.add(off);
      ready = true; onReady.forEach(f => f(inner));
    }).catch(e => console.error('Could not load model', file, e));
    const ex = extra ? extra(g, pivot, f => ready ? f() : onReady.push(f)) : null;
    return { obj: g, update: ex && ex.update ? ex.update : () => {} };
  } };
}
const backZ = y => ringPoint(y, Math.PI, 0).z;
const MODEL_HEAD = [
  glbItem('m_crewcap', '⭐ Worn Crew Cap (real model)', 'worn_crew_hat.glb', { width: 2 * halfWidthAt(TOP - 0.3) + 0.3, top: TOP + 0.16, back: -0.72 }),
  glbItem('m_boonie', '⭐ Boonie Hat (real model)', 'bucket_hat.glb', { width: 2.35, top: TOP + 0.1, centerZ: 0.02,
    recolor: m => { m.map = multicamTex(); m.map.repeat.set(2, 2); m.color.set(0xffffff); m.roughness = 0.95; } }),
];
const MODEL_EYES = [
  glbItem('m_shades', '⭐ Black Sunglasses (real model)', 'black_sunglasses.glb', { width: 2 * halfWidthAt(FACE.eyeY) + 0.14, centerY: FACE.eyeY + 0.03, front: surfaceAt(0, FACE.eyeY, SMOOTH).p.z + 0.16 }),
];
const MODEL_EARS = [
  glbItem('m_comtac', '⭐ ComTac Headset (real model)', 'military_balaclava_and_headset_remaster.glb', { keep: o => /headset/i.test((Array.isArray(o.material) ? o.material[0] : o.material).name), width: 2 * halfWidthAt(0.3) + 0.34, yScale: 0.85, top: TOP + 0.09, centerZ: 0.05 }),
  glbItem('m_headphone', '⭐ Studio Headphones (real model)', 'headphone.glb', { width: 2 * halfWidthAt(0.3) + 0.95, yScale: 0.66, top: TOP + 0.08, centerZ: 0 }),
];
const flakFit = (pick) => ({ keep: (o, c) => pick(c.x), width: 2 * halfWidthAt(-0.8) + 0.22, yScale: 0.62, top: -0.22, centerZ: 0.02 });
const MODEL_BODY = [
  glbItem('m_flak_wood', '⭐ Flak Vest Woodland (real model)', 'body_armor_flak_jacket_remaster.glb', flakFit(x => x < -0.3)),
  glbItem('m_flak_desert', '⭐ Flak Vest Desert (real model)', 'body_armor_flak_jacket_remaster.glb', flakFit(x => x >= -0.3 && x <= 0.3)),
  glbItem('m_flak_green', '⭐ Flak Vest Olive (real model)', 'body_armor_flak_jacket_remaster.glb', flakFit(x => x > 0.3)),
];
function slingExtra(side) {
  return (g, pivot, whenReady) => {
    const y = -0.55;
    pivot.position.set(0, y, backZ(y) - 0.04); pivot.rotation.set(0, Math.PI, side * 0.75);
    const pts = [ringPoint(-0.95, side * 2.4, 0.06), ringPoint(-0.6, side * 1.0, 0.07), ringPoint(-0.25, side * -0.6, 0.06), ringPoint(-0.15, side * -2.0, 0.06), ringPoint(-0.2, Math.PI, 0.08)];
    g.add(ribbon(pts, 0.06, std(0x2b2a22, { roughness: 0.95 }), 0.012));
    const sw = spring(30, 3);
    return { update(st) { pivot.rotation.z = side * 0.75 + sw.step(st.dt, 0, -st.drot.z * 0.05 - st.drot.y * 0.03 + st.kick * 0.3); } };
  };
}
const AKM_COLORS = { low_part_akm: 0x7a3f1d, high_part_akm: 0x2a2b2d, magazine_akm: 0x5a3018 };
const MODEL_BACK = [
  glbItem('m_akm', '⭐ AKM Rifle on Back (real model)', 'akm.glb', { length: 1.7, centerY: 0, centerZ: 0,
    recolor: (m) => { const c = AKM_COLORS[m.name]; if (c !== undefined) { m.color.set(c); m.roughness = m.name === 'high_part_akm' ? 0.45 : 0.6; m.metalness = m.name === 'high_part_akm' ? 0.7 : 0.05; } } }, slingExtra(1)),
  glbItem('m_m4', '⭐ M4 Rifle on Back (real model)', 'classic_m4.glb', { rot: [0, Math.PI / 2, 0], length: 1.7, centerY: 0, centerZ: 0 }, slingExtra(-1)),
];

const NECK_IDS = ['chain', 'bowtie', 'scarf'];
export const SLOTS = [
  { id: 'hair', name: 'Hair', anchor: 'head' }, { id: 'head', name: 'Head', anchor: 'head' }, { id: 'beard', name: 'Beard', anchor: 'head' },
  { id: 'stache', name: 'Mustache', anchor: 'head' }, { id: 'face', name: 'Face', anchor: 'head' },
  { id: 'eyes', name: 'Eyewear', anchor: 'head' }, { id: 'ears', name: 'Ears', anchor: 'head' },
  { id: 'neck', name: 'Neck', anchor: 'waist' }, { id: 'body', name: 'Body', anchor: 'waist' }, { id: 'belt', name: 'Belt', anchor: 'hip' }, { id: 'back', name: 'Back', anchor: 'waist' }
];
const ITEMS_RAW = [
  ...HAIRDOS2.map(i => ({ ...i, slot: 'hair' })), ...BEARDS2.map(i => ({ ...i, slot: 'beard' })), ...STACHES2.map(i => ({ ...i, slot: 'stache' })),
  ...[...MODEL_HEAD, ...MIL_HEAD, ...TK_HEAD, ...LOGO_HEAD, ...HEAD].map(i => ({ ...i, slot: 'head' })), ...[...MIL_FACE, ...TK_FACE].map(i => ({ ...i, slot: 'face' })),
  ...[...MODEL_EYES, ...EYES, ...MIL_EYES, ...TK_EYES].map(i => ({ ...i, slot: 'eyes' })), ...[...MODEL_EARS, ...EARS, ...TK_EARS].map(i => ({ ...i, slot: 'ears' })),
  ...[...BODY.filter(i => NECK_IDS.includes(i.id)), ...MIL_NECK, ...TK_NECK].map(i => ({ ...i, slot: 'neck' })),
  ...[...MODEL_BODY, ...BODY.filter(i => !NECK_IDS.includes(i.id)), ...MIL_BODY, ...TK_BODY].map(i => ({ ...i, slot: 'body' })),
  ...[...MODEL_BACK, ...MIL_BACK, ...TK_BACK].map(i => ({ ...i, slot: 'back' })), ...LOGO_BELT.map(i => ({ ...i, slot: 'belt' }))
];
export const ITEMS = ITEMS_RAW.map(it => ({ ...it, build() { const b = it.build(); finishModel(b.obj); return b; } }));
export const DEFAULT_OUTFIT = { hair: 'none', beard: 'none', stache: 'none', head: 'none', face: 'none', eyes: 'none', ears: 'none', neck: 'none', body: 'none', belt: 'none', back: 'none' };
