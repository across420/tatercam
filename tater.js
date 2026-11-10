// TaterCam potato: russet shape, skin, face craters, skeleton, webcam eye/mouth cutouts, cartoon fallback.
import * as THREE from 'three';

// ---------- Noise ----------
const perm = new Uint8Array(512);
{
  let s = 1337; const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export function vnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = fade(x - X), fy = fade(y - Y), fz = fade(z - Z);
  const h = (i, j, k) => perm[(perm[(perm[(X + i) & 255] + Y + j) & 255] + Z + k) & 255] / 255;
  return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
export function fbm(x, y, z, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f, z * f); n += a; f *= 2.03; a *= 0.5; }
  return s / n;
}
export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const gauss = (v, c, s) => Math.exp(-(((v - c) / s) ** 2));

// ---------- Shape: tall russet like the reference ----------
// Narrow top tilted to the right, waist dip on the left, big lower-left lobe, flatter front to back.
export const SY = 1.34;
export const FACE = { eyeX: 0.3, eyeY: 0.45, mouthY: -0.12 };
// smooth rounded oval like the reference: broad ends, slightly fuller on the lower right, a gentle lean
const widthL = v => 0.85 + 0.02 * gauss(v, 0.6, 0.3) + 0.03 * gauss(v, -0.4, 0.4);
const widthR = v => 0.87 + 0.03 * gauss(v, -0.05, 0.45);
function widths(d) {
  const h = Math.hypot(d.x, d.z) || 1e-6;
  const s = smooth(-0.35, 0.35, d.x / h);
  const v = d.y, wl = widthL(v), wr = widthR(v);
  return { wx: lerp(wl, wr, s), wz: 0.8 * (wl + wr) / 2 };
}
const tilt = v => 0.085 * v;   // top leans a little to the right
const faceMask = d => smooth(0.4, 0.8, d.z) * (1 - smooth(0.5, 0.8, Math.abs(d.y - 0.1)));
function lumpR(d) {
  const fm = faceMask(d);
  const big = (fbm(d.x * 1.6 + 3, d.y * 1.6, d.z * 1.6, 3) - 0.5) * 0.05;
  const mid = (vnoise(d.x * 4, d.y * 4, d.z * 4) - 0.5) * 0.02;
  const small = (vnoise(d.x * 11, d.y * 11, d.z * 11) - 0.5) * 0.006;
  return 1 + (big + mid) * (1 - 0.6 * fm) + small;
}
const V = new THREE.Vector3();
function basePoint(d, out = new THREE.Vector3(), lumps = true) {
  const { wx, wz } = widths(d), r = lumps ? lumpR(d) : 1;
  const h = Math.hypot(d.x, d.z), blunt = h > 1e-6 ? Math.pow(h, -(0.3 + 0.12 * smooth(0, 1, d.y))) : 1;   // round, broad ends
  return out.set(d.x * blunt * wx * r + tilt(d.y), d.y * SY * r, d.z * blunt * wz * r);
}

// Face craters (sockets for eyes and mouth)
const CRATERS = [];
function solveFront(x, y, fn) {         // find the direction on the front whose surface point is at (x, y)
  let dx = x / 0.85, dy = y / SY; const d = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    dx = Math.max(-0.95, Math.min(0.95, dx)); dy = Math.max(-0.95, Math.min(0.95, dy));
    d.set(dx, dy, Math.sqrt(Math.max(1e-4, 1 - dx * dx - dy * dy)));
    fn(d, p);
    dx += (x - p.x) / 0.85 * 0.9; dy += (y - p.y) / SY * 0.9;
  }
  return { d: d.clone(), p: p.clone() };
}
{
  const mk = (x, y, hw, hh, depth) => {
    const { d } = solveFront(x, y, (dd, pp) => basePoint(dd, pp, true));
    CRATERS.push({ c: d, rx: hw / 0.85, ry: hh / SY, depth });
  };
  // craters removed
}
function craterAt(d) {
  let dent = 0, dark = 0;
  if (d.z < 0.2) return { dent, dark };
  for (const c of CRATERS) {
    const du = (d.x - c.c.x) / c.rx, dv = (d.y - c.c.y) / c.ry, q = Math.sqrt(du * du + dv * dv);
    if (q > 1.5) continue;
    const bowl = 1 - smooth(0.72, 1.0, q);
    dent += -c.depth * bowl + 0.018 * Math.exp(-(((q - 1.06) / 0.12) ** 2));
    dark = Math.max(dark, bowl);
  }
  return { dent, dark };
}
// potato "eyes": small crescent dents with a little brow, scattered away from the face
const EYEPITS = [[-0.1, 0.97, 0.22, 1.2], [0.95, 0.2, 0.2, 1], [0.12, -0.96, 0.25, 1.1], [-0.55, -0.6, -0.58, 1], [0.5, 0.45, -0.75, 0.9],
  [-0.85, 0.35, 0.2, 0.8], [0.7, -0.55, 0.35, 0.9], [-0.35, -0.2, -0.9, 0.8], [0.3, 0.85, -0.4, 0.7], [-0.75, 0.75, -0.3, 0.7],
  [0.85, 0.6, -0.1, 0.6], [-0.2, -0.85, 0.48, 0.7], [0.15, 0.1, -1, 0.9], [-0.9, -0.3, 0.3, 0.7], [0.55, -0.85, -0.3, 0.6]]
  .map(([x, y, z, k]) => ({ d: new THREE.Vector3(x, y, z).normalize(), k }));
export function eyePit(d) {
  let dent = 0, mark = 0;
  for (const e of EYEPITS) {
    const dot = d.dot(e.d); if (dot < 0.985) continue;
    const a = Math.acos(Math.min(1, dot)) / (0.045 * e.k);             // 0 at the center, 1 at the edge
    const up = (d.y - e.d.y) / (0.045 * e.k);                           // brow sits on the upper side
    dent += -0.018 * e.k * Math.exp(-a * a * 2.2) + 0.007 * e.k * Math.exp(-((a - 1.1) ** 2) * 6) * smooth(-0.2, 0.6, up);
    mark = Math.max(mark, Math.exp(-a * a * 1.6));
  }
  return { dent, mark };
}
export function shapePoint(d, out = new THREE.Vector3(), { lumps = true, craters = true } = {}) {
  basePoint(d, out, lumps);
  if (lumps) { const { dent } = eyePit(d); out.multiplyScalar(1 + dent); }
  if (craters) { const { dent } = craterAt(d); out.multiplyScalar(1 + dent); }
  return out;
}
// smooth outline used to fit clothing (no lumps, no craters)
export const outerPoint = (d, out = new THREE.Vector3()) => shapePoint(d, out, { lumps: false, craters: false });
export function shapeNormal(d, opts) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const up = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(up, d).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1).normalize();
  const e = 0.004, P = (dir) => shapePoint(dir.clone().normalize(), new THREE.Vector3(), opts);
  a.subVectors(P(d.clone().addScaledVector(t1, e)), P(d.clone().addScaledVector(t1, -e)));
  b.subVectors(P(d.clone().addScaledVector(t2, e)), P(d.clone().addScaledVector(t2, -e)));
  const n = new THREE.Vector3().crossVectors(a, b).normalize();
  if (n.dot(P(d)) < 0) n.negate();
  return n;
}
// point + normal on the real surface at a front (x, y)
export function surfaceAt(x, y, opts) {
  const { d, p } = solveFront(x, y, (dd, pp) => shapePoint(dd, pp, opts));
  return { d, p, n: shapeNormal(d, opts) };
}
// point on the smooth outline at height y, angle a (0 = front, +PI/2 = right), pushed out horizontally
export function ringPoint(y, a, extra = 0) {
  let v = Math.max(-0.999, Math.min(0.999, y / SY)); const d = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    const h = Math.sqrt(1 - v * v); d.set(Math.sin(a) * h, v, Math.cos(a) * h); outerPoint(d, p);
    v = Math.max(-0.999, Math.min(0.999, v + (y - p.y) / SY));
  }
  const hz = Math.hypot(p.x, p.z) || 1; p.x += p.x / hz * extra; p.z += p.z / hz * extra;
  return p;
}
export const halfWidthAt = y => (Math.abs(ringPoint(y, Math.PI / 2).x) + Math.abs(ringPoint(y, -Math.PI / 2).x)) / 2;
export const TOP = outerPoint(new THREE.Vector3(0, 1, 0)).y;

// round dots: distance to random points in a 3D grid
function hash3(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function dots(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); let best = 9, size = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const cx = X + i, cy = Y + j, cz = Z + k, h = hash3(cx, cy, cz);
    if (h > 0.32) continue;                                   // not every cell gets a freckle
    const px = cx + hash3(cy, cz, cx + 7), py = cy + hash3(cz, cx, cy + 13), pz = cz + hash3(cx + 3, cy + 5, cz);
    const r = 0.12 + 0.3 * hash3(cz + 9, cy + 1, cx + 2);
    const dd = Math.hypot(x - px, y - py, z - pz) / r;
    if (dd < best) { best = dd; size = r; }
  }
  return { v: 1 - smooth(0.55, 1, best), size };
}
const SPROUTS = [[-0.1, 0.97, 0.22], [0.12, -0.96, 0.25]].map(p => new THREE.Vector3(...p).normalize());
// ---------- Skin: built to read like a photo of a russet ----------
// blob-shaped blemishes: distance to random points, edges roughened with noise
function blots(x, y, z, keep) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); let best = 9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const cx = X + i, cy = Y + j, cz = Z + k;
    if (hash3(cx, cy, cz) > keep) continue;
    const px = cx + hash3(cy, cz, cx + 7), py = cy + hash3(cz, cx, cy + 13), pz = cz + hash3(cx + 3, cy + 5, cz);
    const r = 0.14 + 0.32 * hash3(cz + 9, cy + 1, cx + 2);
    const dd = Math.hypot(x - px, y - py, z - pz) / r; if (dd < best) best = dd;
  }
  return best;
}
const ridged = (x, y, z) => 1 - Math.abs(vnoise(x, y, z) * 2 - 1);
export function makeSkinForBake(W, H) { return makeSkin(W, H); }
function makeSkin(W = 2048, H = 1024) {
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const colC = mk(), bumpC = mk(), roughC = mk();
  const cctx = colC.getContext('2d'), bctx = bumpC.getContext('2d'), rctx = roughC.getContext('2d');
  const col = cctx.createImageData(W, H), bmp = bctx.createImageData(W, H), rgh = rctx.createImageData(W, H);
  // colors sampled from real russet photos: dusty beige skin, brown russeting, grey dirt, pale scuffs
  const base = [166, 122, 78], warm = [182, 136, 86], pale = [192, 152, 104], russet = [138, 96, 58], deep = [100, 68, 40];
  const freck = [92, 66, 48], dirt = [122, 104, 84], flesh = [196, 164, 106], pitc = [88, 60, 38];
  const d = new THREE.Vector3(), c = [0, 0, 0];
  const mix = (t, k) => { if (k <= 0) return; c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k; };
  for (let j = 0; j < H; j++) {
    const theta = (j + 0.5) / H * Math.PI, st = Math.sin(theta), ct = Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const phi = (i + 0.5) / W * Math.PI * 2;
      d.set(-Math.cos(phi) * st, ct, Math.sin(phi) * st);
      const x = d.x, y = d.y, z = d.z;
      c[0] = base[0]; c[1] = base[1]; c[2] = base[2];
      // broad, low-contrast tone drift
      const tone = fbm(x * 1.5 + 11, y * 1.5, z * 1.5, 4);
      mix(warm, smooth(0.4, 0.7, tone) * 0.6);
      mix(pale, smooth(0.62, 0.8, fbm(x * 2.5 + 31, y * 2.5, z * 2.5, 3)) * 0.35);
      // russeting: blotchy brown zones with warped, broken edges
      const wx = x + (vnoise(x * 6, y * 6, z * 6) - 0.5) * 0.25, wy = y + (vnoise(x * 6 + 9, y * 6, z * 6) - 0.5) * 0.25;
      const rz = fbm(wx * 3.2 + 3, wy * 3.2, z * 3.2, 5);
      const rz2 = fbm(x * 12 + 21, y * 12, z * 12, 3);
      const rus = smooth(0.55, 0.7, rz) * (0.45 + 0.55 * smooth(0.35, 0.7, rz2));
      mix(russet, rus * 0.7);
      mix(deep, smooth(0.66, 0.78, rz) * smooth(0.5, 0.75, rz2) * 0.55);
      // fine netting (the corky web on russet skin)
      const net = ridged(x * 38 + 2, y * 38, z * 38) * 0.6 + ridged(x * 75 + 7, y * 75, z * 75) * 0.4;
      const netLine = smooth(0.82, 0.97, net);
      mix(russet, netLine * 0.28 * (0.5 + rus));
      // irregular freckles and blemishes (warped, uneven, never perfect dots)
      const rough = (vnoise(x * 70, y * 70, z * 70) - 0.5) * 0.7 + (vnoise(x * 200 + 3, y * 200, z * 200) - 0.5) * 0.35;
      const bA = blots(x * 11 + 5, y * 11, z * 11, 0.42) + rough, bB = blots(x * 26 + 9, y * 26, z * 26, 0.3) + rough * 0.8;
      const clump = smooth(0.38, 0.7, fbm(x * 2.8 + 70, y * 2.8, z * 2.8, 3));
      const halo = (1 - smooth(0.7, 1.6, bA)) * 0.45;                                // soft brown halo around blemishes
      const fr = Math.max((1 - smooth(0.45, 0.85, bA)) * 0.85, (1 - smooth(0.5, 0.9, bB)) * 0.7 * (0.4 + 0.6 * clump));
      mix(russet, halo * (0.5 + 0.5 * clump));
      mix(freck, fr * (0.55 + 0.45 * clump));
      // tiny lenticels: pale specks with a dark center
      const len = vnoise(x * 150 + 13, y * 150, z * 150);
      mix(pale, smooth(0.9, 0.97, len) * 0.5);
      mix(freck, smooth(0.955, 0.99, len) * 0.5);
      // dirt: greyish, settles in some areas
      const dr = smooth(0.58, 0.8, fbm(x * 4 + 40, y * 4, z * 4, 4));
      mix(dirt, dr * 0.32);
      // scuffs where the skin rubbed off (pale flesh showing, crisp edge)
      const sc = fbm(x * 7 + 90, y * 7, z * 7, 4), scuff = smooth(0.75, 0.775, sc) * smooth(0.45, 0.65, fbm(x * 2 + 5, y * 2, z * 2, 2));
      mix(flesh, scuff * 0.3);
      // potato eyes and sprouts
      const pit = eyePit(d);
      mix(pitc, pit.mark * 0.7);
      // grain everywhere
      const g = (vnoise(x * 400, y * 400, z * 400) - 0.5) * 14 + (vnoise(x * 210 + 4, y * 210, z * 210) - 0.5) * 10;
      const o = (j * W + i) * 4;
      col.data[o] = Math.max(0, Math.min(255, c[0] + g)); col.data[o + 1] = Math.max(0, Math.min(255, c[1] + g)); col.data[o + 2] = Math.max(0, Math.min(255, c[2] + g * 0.8)); col.data[o + 3] = 255;
      // height: corky netting raised, scuffs sunk a hair, fine pebbling
      const hgt = 0.5 + 0.12 * (rz - 0.5) + netLine * 0.16 + rus * 0.06 - scuff * 0.08 + 0.1 * (vnoise(x * 120, y * 120, z * 120) - 0.5) + 0.08 * (vnoise(x * 300, y * 300, z * 300) - 0.5) - fr * 0.03 + smooth(0.9, 0.97, len) * 0.05;
      bmp.data[o] = bmp.data[o + 1] = bmp.data[o + 2] = 255 * Math.min(1, Math.max(0, hgt)); bmp.data[o + 3] = 255;
      // roughness: russet and dirt are dull, scuffs slightly moist
      const rv = 0.72 + rus * 0.12 + dr * 0.08 + netLine * 0.06 - scuff * 0.25 - smooth(0.4, 0.7, tone) * 0.06;
      rgh.data[o] = rgh.data[o + 1] = rgh.data[o + 2] = 255 * Math.min(1, Math.max(0, rv)); rgh.data[o + 3] = 255;
    }
  }
  cctx.putImageData(col, 0, 0); bctx.putImageData(bmp, 0, 0); rctx.putImageData(rgh, 0, 0);
  const map = new THREE.CanvasTexture(colC); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(bumpC); bumpMap.anisotropy = 8;
  const roughnessMap = new THREE.CanvasTexture(roughC);
  return { map, bumpMap, roughnessMap };
}

// ---------- Build the rigged potato ----------
// Bones: hip (bottom) -> waist -> head. Head moves the face; waist and hip give the lower-body sway.
export const BONE_Y = { hip: -1.3, waist: -0.8, head: -0.32 };
export function buildTater({ skinSize = 1024, textureBase = null, hiRes = true } = {}) {
  const geo = new THREE.SphereGeometry(1, 220, 160);
  const pa = geo.attributes.position, v = new THREE.Vector3(), p = new THREE.Vector3();
  const idx = [], wts = [];
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i).normalize();
    shapePoint(v, p); pa.setXYZ(i, p.x, p.y, p.z);
    const y = p.y;
    if (y > -0.22) { idx.push(2, 0, 0, 0); wts.push(1, 0, 0, 0); }
    else if (y > -0.6) { const k = smooth(-0.6, -0.22, y); idx.push(2, 1, 0, 0); wts.push(k, 1 - k, 0, 0); }
    else if (y > -1.05) { const k = smooth(-1.05, -0.6, y); idx.push(1, 0, 0, 0); wts.push(k, 1 - k, 0, 0); }
    else { idx.push(0, 0, 0, 0); wts.push(1, 0, 0, 0); }
  }
  geo.computeVertexNormals();
  // cavity shading: darken pits and grooves so the form reads like a real object
  const colors = new Float32Array(pa.count * 3), q = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i); const dir = v.clone().normalize();
    const pit = eyePit(dir).dent;
    const groove = (fbm(dir.x * 1.6 + 3, dir.y * 1.6, dir.z * 1.6, 3) - 0.5);
    const ao = Math.min(1, Math.max(0.55, 1 + pit * 14 + Math.min(0, groove) * 0.5));
    colors[i * 3] = ao; colors[i * 3 + 1] = ao * 0.98; colors[i * 3 + 2] = ao * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  // the skin is pre-baked to image files (sharp and instant); fall back to building it if they can't load
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xb08a5e, bumpScale: 1.6, roughness: 1, metalness: 0, vertexColors: true,
    sheen: 0.12, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xd9c3a0), envMapIntensity: 0.4
  });
  const applySkin = ({ map, bumpMap, roughnessMap }) => { mat.color.set(0xffffff); Object.assign(mat, { map, bumpMap, roughnessMap }); mat.needsUpdate = true; };
  if (textureBase) {
    const L = new THREE.TextureLoader(), sfx = hiRes ? '' : '_2k', got = {};
    let left = 3, failed = false;
    const done = () => { if (--left) return; if (failed) applySkin(makeSkin(skinSize * 2, skinSize)); else applySkin(got); };
    for (const [key, file] of [['map', 'color'], ['bumpMap', 'bump'], ['roughnessMap', 'rough']]) {
      L.load(textureBase + 'potato_' + file + sfx + '.jpg', tex => { if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; got[key] = tex; done(); }, undefined, () => { failed = true; done(); });
    }
  } else applySkin(makeSkin(skinSize * 2, skinSize));
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.frustumCulled = false;
  const hip = new THREE.Bone(), waist = new THREE.Bone(), head = new THREE.Bone();
  hip.position.y = BONE_Y.hip; waist.position.y = BONE_Y.waist - BONE_Y.hip; head.position.y = BONE_Y.head - BONE_Y.waist;
  hip.add(waist); waist.add(head); mesh.add(hip);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hip, waist, head]));
  // anchors: put things here using normal potato coordinates
  const anchor = (bone, y) => { const a = new THREE.Group(); a.position.y = -y; bone.add(a); return a; };
  const anchors = { hip: anchor(hip, BONE_Y.hip), waist: anchor(waist, BONE_Y.waist), head: anchor(head, BONE_Y.head) };
  // little sprout nubs
  const nubMat = new THREE.MeshStandardMaterial({ color: 0x9c8a4c, roughness: 0.9 });
  for (const s of SPROUTS) {
    const sp = shapePoint(s), n = shapeNormal(s);
    const parent = sp.y > -0.22 ? anchors.head : sp.y > -0.8 ? anchors.waist : anchors.hip;
    for (let k = 0; k < 3; k++) {
      const nub = new THREE.Mesh(new THREE.SphereGeometry(0.01 + k * 0.003, 8, 6), nubMat);
      nub.position.copy(sp).addScaledVector(n, 0.005).add(new THREE.Vector3((k - 1) * 0.022, (k % 2) * 0.015, 0));
      nub.scale.set(1, 1.4, 1); parent.add(nub);
    }
  }
  return { mesh, bones: { hip, waist, head }, anchors };
}

// ---------- One Euro filter (smooth when still, fast when moving) ----------
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = undefined; this.dx = 0; }
  static a(cut, dt) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  filter(x, dt) {
    if (this.x === undefined || !(dt > 0)) { this.x = x; return x; }
    const dx = (x - this.x) / dt; this.dx += OneEuro.a(this.dCutoff, dt) * (dx - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

// ---------- Your real eyes and lips, cut tight to their outlines ----------
const EYE_A = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];        // left side of the camera image
const EYE_B = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];      // right side of the camera image
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const EYE_CENTER_A = [33, 133], EYE_CENTER_B = [263, 362];

export class RealFace {
  constructor(parent) {
    this.group = new THREE.Group(); parent.add(this.group);
    this.hasFrame = false;
    this.f = { u: new OneEuro(0.8, 0.01), ang: new OneEuro(1.0, 0.3) };
    const eyeAt = x => surfaceAt(x, FACE.eyeY);
    this.eyeL = this.feature(eyeAt(-FACE.eyeX), 0.44, 0.31, 320, 226, 0.012);
    this.eyeR = this.feature(eyeAt(FACE.eyeX), 0.44, 0.31, 320, 226, 0.012);
    this.mouth = this.feature(surfaceAt(0, FACE.mouthY), 0.66, 0.46, 384, 268, 0.012);
  }
  feature(at, w, h, cw, ch, lift) {
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.position.copy(at.p).addScaledVector(at.n, lift);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), at.n);
    mesh.renderOrder = 3; this.group.add(mesh);
    return { canvas, ctx, tex, mesh, fx: new OneEuro(1.5, 0.05), fy: new OneEuro(1.5, 0.05) };
  }
  // draw the region around c (rotated level, mirrored if needed), then keep only the polygon
  draw(f, video, c, cropW, ang, mirror, filter, poly, grow, dt) {
    const { ctx, canvas } = f, cw = canvas.width, ch = canvas.height, s = cw / cropW;
    const cx = f.fx.filter(c.x, dt), cy = f.fy.filter(c.y, dt);
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    const toCanvas = (px, py) => {
      const dx = px - cx, dy = py - cy;
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      return [cw / 2 + (mirror ? -rx : rx) * s, ch / 2 + ry * s];
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, cw, ch);
    ctx.filter = filter;
    ctx.translate(cw / 2, ch / 2); ctx.scale(mirror ? -s : s, s); ctx.rotate(-ang); ctx.translate(-cx, -cy);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    ctx.restore();
    // mask = the outline itself, grown a hair for lashes/lip line, with a tiny soft edge
    const pts = poly.map(([px, py]) => toCanvas(px, py));
    let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= pts.length; my /= pts.length;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.filter = `blur(${Math.max(1, cw * 0.006).toFixed(1)}px)`;
    ctx.fillStyle = '#000'; ctx.beginPath();
    pts.forEach(([x, y], i) => { const X = mx + (x - mx) * grow, Y = my + (y - my) * grow; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.fill();
    ctx.restore();
    f.tex.needsUpdate = true;
  }
  capture(video, lm, { mirror = true, tint = 0.3, size = 1, dt = 1 / 30 } = {}) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !lm || lm.length < 468) return;
    const P = i => [lm[i].x * w, lm[i].y * h];
    const mid = ids => { let x = 0, y = 0; for (const i of ids) { x += lm[i].x; y += lm[i].y; } return { x: x / ids.length * w, y: y / ids.length * h }; };
    const A = mid(EYE_CENTER_A), B = mid(EYE_CENTER_B);
    const za = (lm[33].z + lm[133].z) / 2 * w, zb = (lm[263].z + lm[362].z) / 2 * w;
    const u = this.f.u.filter(Math.hypot(B.x - A.x, B.y - A.y, zb - za), dt);
    const ang = this.f.ang.filter(Math.atan2(B.y - A.y, B.x - A.x), dt);
    const filter = `sepia(${tint}) saturate(${1 + tint * 0.4}) contrast(1.08) brightness(1.04)`;
    const polyA = EYE_A.map(P), polyB = EYE_B.map(P), polyM = LIPS.map(P);
    const mouthC = mid([61, 291, 0, 17]);
    const [left, lp, right, rp] = mirror ? [B, polyB, A, polyA] : [A, polyA, B, polyB];
    this.draw(this.eyeL, video, left, u * 0.95, ang, mirror, filter, lp, 1.08, dt);
    this.draw(this.eyeR, video, right, u * 0.95, ang, mirror, filter, rp, 1.08, dt);
    this.draw(this.mouth, video, mouthC, u * 1.45, ang, mirror, filter, polyM, 1.06, dt);
    for (const f of [this.eyeL, this.eyeR, this.mouth]) f.mesh.scale.setScalar(size);
    this.hasFrame = true;
  }
}

// ---------- Cartoon face (fallback) ----------
export class CartoonFace {
  constructor(parent) {
    const face = this.group = new THREE.Group(); parent.add(face);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, envMapIntensity: 0.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.25, envMapIntensity: 0.6 });
    const place = (obj, x, y, off) => { const s = surfaceAt(x, y); obj.position.copy(s.p).addScaledVector(s.n, off); obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.n); };
    const makeEye = x => {
      const g = new THREE.Group(); place(g, x, FACE.eyeY, 0.03);
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 20), white); w.scale.set(1, 0.9, 0.6); g.add(w);
      const pupil = new THREE.Group();
      const pm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), black); pm.scale.set(1, 1.05, 0.5); pupil.add(pm);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), white); hl.position.set(0.025, 0.03, 0.035); pupil.add(hl);
      pupil.position.z = 0.08; g.add(pupil); face.add(g); return { g, pupil };
    };
    this.eyeL = makeEye(-FACE.eyeX); this.eyeR = makeEye(FACE.eyeX);
    this.mouth = new THREE.Group(); place(this.mouth, 0, FACE.mouthY, 0.0);
    this.mouth.userData.y0 = this.mouth.position.y;
    this.mouthInner = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 20), new THREE.MeshStandardMaterial({ color: 0x3b0f0f, roughness: 0.6 }));
    this.mouth.add(this.mouthInner);
    this.tongue = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), new THREE.MeshStandardMaterial({ color: 0xe0606a, roughness: 0.5 }));
    this.tongue.position.set(0, -0.1, 0.09); this.tongue.scale.set(1, 0.6, 1); this.mouthInner.add(this.tongue);
    face.add(this.mouth);
  }
  update(c) {
    this.eyeL.g.scale.y = Math.max(0.07, 1 - c.blinkL);
    this.eyeR.g.scale.y = Math.max(0.07, 1 - c.blinkR);
    for (const e of [this.eyeL, this.eyeR]) {
      e.pupil.position.x = THREE.MathUtils.clamp(c.gx, -1, 1) * 0.05;
      e.pupil.position.y = THREE.MathUtils.clamp(c.gy, -1, 1) * 0.04;
    }
    this.mouthInner.scale.set(0.8 + c.smile * 0.5 - c.pucker * 0.4 + c.jaw * 0.1, 0.1 + c.jaw * 0.85, 0.3);
    this.mouth.position.y = this.mouth.userData.y0 + c.smile * 0.02 - c.jaw * 0.07;
    this.tongue.visible = c.jaw > 0.18;
  }
}
