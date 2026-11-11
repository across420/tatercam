import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { buildTater, RealFace, CartoonFace, OneEuro, TOP, BONE_Y } from './tater.js';
import { SLOTS, ITEMS, DEFAULT_OUTFIT, CUSTOM, CREDITS } from './wardrobe.js';

// ---------- Saved settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('tater.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tater.' + k, JSON.stringify(v)); } catch {} }
};

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const isPhone = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
renderer.setPixelRatio(Math.min(devicePixelRatio, isPhone ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.1, 8.8);
camera.lookAt(0, 0.1, 0);

scene.add(new THREE.HemisphereLight(0xfff2dd, 0x4a2c18, 1.0));
const key = new THREE.DirectionalLight(0xfff4e6, 2.5); key.position.set(2.5, 3, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xd8e6ff, 0.7); fill.position.set(-3, 0.5, 3); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffcf8a, 1.8); rim.position.set(-3, 2, -3); scene.add(rim);

function fitCamera() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  camera.position.z = 8.8 * Math.max(1, 0.82 / camera.aspect);   // keep the whole potato in view on tall phone screens
  renderer.setSize(innerWidth, innerHeight);
}
fitCamera();
addEventListener('resize', fitCamera);

// ---------- The tater ----------
const statusEl = document.getElementById('status');
const avatar = new THREE.Group(); scene.add(avatar);
statusEl.textContent = 'Baking your potato…';
const rig = buildTater({ skinSize: isPhone ? 512 : 1024, textureBase: './assets/', hiRes: !isPhone });
avatar.add(rig.mesh);
const { hip, waist, head } = rig.bones;
const cartoon = new CartoonFace(rig.anchors.head);
const realFace = new RealFace(rig.anchors.head);
statusEl.textContent = 'Pick your webcam and press Start camera.';

// ---------- Face style ----------
const faceSel = document.getElementById('faceStyle');
const tintIn = document.getElementById('tint');
const sizeIn = document.getElementById('featSize');
const faceOpts = { mode: store.get('faceMode', 'real'), tint: store.get('tint', 0.3), size: store.get('featSize', 1) };
faceSel.value = faceOpts.mode; tintIn.value = faceOpts.tint; sizeIn.value = faceOpts.size;
faceSel.onchange = () => { faceOpts.mode = faceSel.value; store.set('faceMode', faceOpts.mode); };
tintIn.oninput = () => { faceOpts.tint = +tintIn.value; store.set('tint', faceOpts.tint); };
sizeIn.oninput = () => { faceOpts.size = +sizeIn.value; store.set('featSize', faceOpts.size); };

// ---------- Wardrobe ----------
const outfit = { ...DEFAULT_OUTFIT, ...store.get('outfit3', {}) };
const worn = {};
function disposeDeep(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of mats) { for (const k in m) if (m[k] && m[k].isTexture && !m[k].userData.shared) m[k].dispose(); m.dispose(); }
  });
}
function equip(slot, id) {
  const cur = worn[slot];
  if (cur && cur.obj) { cur.obj.parent && cur.obj.parent.remove(cur.obj); disposeDeep(cur.obj); }
  worn[slot] = { id: 'none' };
  const item = ITEMS.find(i => i.id === id && i.slot === slot);
  if (item) {
    try {
      const built = item.build();
      const anchorName = item.anchor || SLOTS.find(s => s.id === slot).anchor;
      rig.anchors[anchorName].add(built.obj); worn[slot] = { id, ...built };
    } catch (e) { console.error('Could not build', id, e); statusEl.textContent = 'Could not load ' + item.name + ': ' + e.message; }
  }
  outfit[slot] = worn[slot].id; store.set('outfit3', outfit); renderWardrobe();
}
const wardrobeEl = document.getElementById('wardrobeList');
function renderWardrobe() {
  wardrobeEl.innerHTML = SLOTS.map(s => `
    <div class="slot"><div class="slotName">${s.name}</div>
      <div class="items">
        <button class="item ${outfit[s.id] === 'none' ? 'on' : ''}" data-slot="${s.id}" data-id="none">None</button>
        ${ITEMS.filter(i => i.slot === s.id).map(i => `<button class="item ${outfit[s.id] === i.id ? 'on' : ''}" data-slot="${s.id}" data-id="${i.id}">${i.name}</button>`).join('')}
      </div></div>`).join('');
}
wardrobeEl.addEventListener('click', e => { const b = e.target.closest('button.item'); if (b) { equip(b.dataset.slot, b.dataset.id); b.blur(); } });
for (const s of SLOTS) equip(s.id, outfit[s.id]);

// ---------- Model credits (CC BY 4.0) ----------
const creditsEl = document.getElementById('credits');
if (creditsEl) creditsEl.innerHTML = CREDITS.map(([t, by, url]) => `<div>"${t}" by ${by} — <a href="${url}" target="_blank" rel="noopener">Fab</a>, CC BY 4.0</div>`).join('');

// ---------- Your logos (cap + pouch tins) ----------
function loadLogo(kind, src) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'), s = Math.min(1, 512 / Math.max(im.width, im.height)); c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); CUSTOM[kind] = c; res(c); };
    im.onerror = () => res(null); im.src = src;
  });
}
function refreshLogoItems() { if (outfit.head === 'blackcap') equip('head', 'blackcap'); if (outfit.belt === 'pouchbelt') equip('belt', 'pouchbelt'); }
for (const kind of ['cap', 'can']) {
  const saved = store.get('logo.' + kind, null);
  if (saved) loadLogo(kind, saved).then(refreshLogoItems);
  const input = document.getElementById('logo-' + kind);
  if (input) input.addEventListener('change', () => {
    const f = input.files && input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => { const c = await loadLogo(kind, r.result); if (!c) { statusEl.textContent = 'That picture could not be opened. Try a PNG or JPG.'; return; } store.set('logo.' + kind, c.toDataURL('image/png')); refreshLogoItems(); statusEl.textContent = kind === 'cap' ? 'Cap logo updated.' : 'Tin lid design updated.'; };
    r.readAsDataURL(f);
  });
}
const clearLogos = document.getElementById('logo-clear');
if (clearLogos) clearLogos.addEventListener('click', () => { CUSTOM.cap = CUSTOM.can = null; store.set('logo.cap', null); store.set('logo.can', null); refreshLogoItems(); statusEl.textContent = 'Back to the built-in designs.'; });


// ---------- Steam ----------
const steamTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const puffs = [];
function spawnPuff(strength = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.position.set((Math.random() - 0.5) * 0.5, TOP + 0.05, (Math.random() - 0.5) * 0.3);
  s.userData = { vy: 0.35 + Math.random() * 0.35 * strength, vx: (Math.random() - 0.5) * 0.15, age: 0, life: 2 + Math.random() * 1.2, peak: 0.3 + 0.25 * strength };
  s.renderOrder = 5; rig.anchors.head.add(s); puffs.push(s);
}

// ---------- Face tracking ----------
const startBtn = document.getElementById('start');
const camSelect = document.getElementById('camSelect');
const video = document.getElementById('preview');
let landmarker = null, lastVideoTime = -1, lastFaceAt = 0, zBase = null;
let flipped = store.get('flipped', false);

const target = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, blinkL: 0, blinkR: 0, jaw: 0, smile: 0, pucker: 0, browUp: 0, browDownL: 0, browDownR: 0, gx: 0, gy: 0 };
const cur = { ...target };
// jitter filters: calm when you hold still, instant when you move
const filt = {
  pitch: new OneEuro(1.0, 0.6), yaw: new OneEuro(1.0, 0.6), roll: new OneEuro(1.0, 0.6),
  tx: new OneEuro(0.8, 0.8), ty: new OneEuro(0.8, 0.8), tz: new OneEuro(0.5, 0.3),
  jaw: new OneEuro(3, 2), smile: new OneEuro(2, 1), pucker: new OneEuro(2, 1), browUp: new OneEuro(2, 1),
  blinkL: new OneEuro(6, 3), blinkR: new OneEuro(6, 3), gx: new OneEuro(2, 1), gy: new OneEuro(2, 1)
};
const clamp01 = v => Math.min(1, Math.max(0, v));
const mat = new THREE.Matrix4(), euler = new THREE.Euler(), tpos = new THREE.Vector3();

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

function cameraError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, then press Start again. (The claude.ai preview cannot use the camera; open the hosted version.)';
  if (n === 'NotReadableError' || n === 'TrackStartError') return 'That camera is busy. Close OBS, Discord, Zoom or anything else using it (or remove it from OBS), then press Start again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'That camera was not found. Plug it in, press Refresh, and pick it again.';
  return (e && (e.message || e.name)) || String(e);
}

async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const saved = store.get('camId', '');
    const keep = camSelect.value || saved;
    camSelect.innerHTML = devs.length
      ? devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join('')
      : '<option value="">No cameras found</option>';

    if (devs.some(d => d.deviceId === keep)) camSelect.value = keep;
    return devs;
  } catch (e) { console.error(e); return []; }
}

// Ask for camera access once so Windows reveals every camera's real name.
async function unlockCameraNames() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    s.getTracks().forEach(t => t.stop());
  } catch (e) { console.warn('Camera permission check:', e); }
  return listCameras();
}

async function loadTracker() {
  if (landmarker) return;
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate },
    runningMode: 'VIDEO', numFaces: 1,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
  });
  try { landmarker = await withTimeout(FaceLandmarker.createFromOptions(fileset, opts('GPU')), 20000, 'GPU face tracker'); }
  catch (e) { console.warn('GPU tracker failed, using CPU', e); landmarker = await withTimeout(FaceLandmarker.createFromOptions(fileset, opts('CPU')), 30000, 'Face tracker'); }
}

async function startCamera() {
  startBtn.disabled = true;
  // 1. Camera first, so you can see it working even if face tracking has trouble.
  try {
    statusEl.textContent = 'Starting webcam…';
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const id = camSelect.value;
    video.srcObject = await withTimeout(navigator.mediaDevices.getUserMedia({
      video: id ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    }), 15000, 'Opening the camera');
    await video.play();
    store.set('camId', id);
    await listCameras();
    if (!store.get('seenPreview', false)) { video.classList.remove('hidden'); store.set('seenPreview', true); }
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Camera problem: ' + cameraError(e);
    startBtn.disabled = false;
    return;
  }
  // 2. Then face tracking.
  try {
    statusEl.textContent = 'Camera on. Loading face tracker…';
    await loadTracker();
    store.set('autostart', true);
    statusEl.textContent = 'Tracking! Press H to hide this panel, C to hide the webcam preview.';
    startBtn.textContent = 'Restart camera';
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Camera works, but face tracking failed: ' + (e.message || e) + '. Check your internet connection and press Start again.';
  }
  startBtn.disabled = false;
}
startBtn.onclick = startCamera;
camSelect.onchange = () => { if (video.srcObject) startCamera(); };
document.getElementById('refresh').onclick = unlockCameraNames;
navigator.mediaDevices.addEventListener('devicechange', listCameras);
addEventListener('error', e => { statusEl.textContent = 'Error: ' + e.message; });
addEventListener('unhandledrejection', e => { statusEl.textContent = 'Error: ' + ((e.reason && e.reason.message) || e.reason); });
listCameras().then(() => { if (store.get('autostart', false)) startCamera(); });

let lastTrackT = 0;
function track() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const now = performance.now(), fdt = lastTrackT ? Math.min(0.2, (now - lastTrackT) / 1000) : 1 / 30; lastTrackT = now;
  const res = landmarker.detectForVideo(video, now);
  if (!res.faceBlendshapes || !res.faceBlendshapes.length) return;
  lastFaceAt = now;
  const m = {};
  for (const c of res.faceBlendshapes[0].categories) m[c.categoryName] = c.score;
  const F = (k, v) => { target[k] = filt[k] ? filt[k].filter(v, fdt) : v; };

  let bL = clamp01((m.eyeBlinkLeft - 0.3) / 0.4), bR = clamp01((m.eyeBlinkRight - 0.3) / 0.4);
  let dL = m.browDownLeft, dR = m.browDownRight;
  if (flipped) { [bL, bR] = [bR, bL]; [dL, dR] = [dR, dL]; }
  F('blinkL', bL); F('blinkR', bR); target.browDownL = dL; target.browDownR = dR;
  F('jaw', clamp01(m.jawOpen * 1.6));
  F('smile', clamp01((m.mouthSmileLeft + m.mouthSmileRight) * 0.7));
  F('pucker', clamp01(m.mouthPucker * 1.3));
  F('browUp', clamp01(m.browInnerUp * 1.4));
  const lookLeft = (m.eyeLookOutLeft + m.eyeLookInRight - m.eyeLookInLeft - m.eyeLookOutRight) / 2;
  F('gx', (flipped ? 1 : -1) * lookLeft);
  F('gy', (m.eyeLookUpLeft + m.eyeLookUpRight - m.eyeLookDownLeft - m.eyeLookDownRight) / 2);

  if (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length) {
    mat.fromArray(res.facialTransformationMatrixes[0].data);
    euler.setFromRotationMatrix(mat, 'YXZ');
    const s = flipped ? -1 : 1;
    F('pitch', euler.x); F('yaw', euler.y * s); F('roll', euler.z * s);
    tpos.setFromMatrixPosition(mat);
    if (zBase === null) zBase = tpos.z; zBase += (tpos.z - zBase) * 0.002;   // slowly re-centers
    F('tx', THREE.MathUtils.clamp(tpos.x * 0.03 * s, -1, 1));
    F('ty', THREE.MathUtils.clamp(tpos.y * 0.025, -0.5, 0.5));
    F('tz', THREE.MathUtils.clamp((tpos.z - zBase) * 0.012, -0.2, 0.25));
  }
  if (faceOpts.mode === 'real' && res.faceLandmarks && res.faceLandmarks.length)
    realFace.capture(video, res.faceLandmarks[0], { mirror: !flipped, tint: faceOpts.tint, size: faceOpts.size, dt: fdt });
}

// ---------- Hotkeys ----------
const bgs = ['#00ff00', '#0047ff', '#16161c'];
let bgIdx = store.get('bg', 0);
const ui = document.getElementById('ui'), wardrobe = document.getElementById('wardrobe');
document.body.style.background = bgs[bgIdx];
if (store.get('uiHidden', false)) { ui.classList.add('hidden'); wardrobe.classList.add('hidden'); }
if (store.get('wardrobeHidden', isPhone)) wardrobe.classList.add('hidden');
let hopY = 0, hopV = 0, squash = 0, spinT = -1, kick = 0, visorDown = store.get('visorDown', false), nvgDown = false;

addEventListener('keydown', e => {
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === '1' || k === ' ') { if (hopY === 0) hopV = 4.2; e.preventDefault(); }
  if (k === '2' && spinT < 0) spinT = 0;
  if (k === '3') for (let i = 0; i < 14; i++) spawnPuff(2.2);
  if (k === 'b') { bgIdx = (bgIdx + 1) % bgs.length; document.body.style.background = bgs[bgIdx]; store.set('bg', bgIdx); }
  if (k === 'm') { flipped = !flipped; store.set('flipped', flipped); }
  if (k === 'c') video.classList.toggle('hidden');
  if (k === 'e') { faceOpts.mode = faceOpts.mode === 'real' ? 'cartoon' : 'real'; faceSel.value = faceOpts.mode; store.set('faceMode', faceOpts.mode); }
  if (k === 'v') { visorDown = !visorDown; store.set('visorDown', visorDown); }
  if (k === 'g') nvgDown = !nvgDown;
  if (k === 'w') { wardrobe.classList.toggle('hidden'); store.set('wardrobeHidden', wardrobe.classList.contains('hidden')); }
  if (k === 'h') {
    const hide = !ui.classList.contains('hidden');
    ui.classList.toggle('hidden', hide); wardrobe.classList.toggle('hidden', hide || store.get('wardrobeHidden', isPhone));
    store.set('uiHidden', hide);
  }
  if (k === 'f') { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} }
});

// ---------- Body motion ----------
function spring3(k, d) { return { x: new THREE.Vector3(), v: new THREE.Vector3(), step(dt, tgt, kick) { this.v.addScaledVector(kick, 1).add(tgt.clone().sub(this.x).multiplyScalar(k * dt)).addScaledVector(this.v, -d * dt); this.x.addScaledVector(this.v, dt); return this.x; } }; }
const waistSpring = spring3(55, 7), hipSpring = spring3(35, 6);
const prevHeadT = new THREE.Vector3(), headT = new THREE.Vector3(), headVel = new THREE.Vector3(), kickV = new THREE.Vector3();
const totalRot = { x: 0, y: 0, z: 0 }, prevTotal = { x: 0, y: 0, z: 0 }, drot = { x: 0, y: 0, z: 0 };

// ---------- Animate ----------
const clock = new THREE.Clock();
let t = 0, talkPhase = 0, puffTimer = 0, nextIdleBlink = 3, idleBlink = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.max(1 / 240, Math.min(clock.getDelta(), 0.05)); t += dt;
  try { track(); } catch (e) { console.error(e); }

  const tracking = performance.now() - lastFaceAt < 800;
  if (!tracking) {
    for (const k in target) target[k] *= 0.92;
    nextIdleBlink -= dt;
    if (nextIdleBlink < 0) { idleBlink = 0.15; nextIdleBlink = 2.5 + Math.random() * 3; }
    if (idleBlink > 0) { idleBlink -= dt; target.blinkL = target.blinkR = 1; }
  }
  const a = 1 - Math.exp(-dt * 40);
  for (const k in cur) cur[k] += (target[k] - cur[k]) * a;
  const idle = tracking ? 0 : 1;

  // where your head points (plus a lazy idle sway when you're away)
  headT.set(
    cur.pitch + Math.sin(t * 0.9) * 0.05 * idle,
    cur.yaw + Math.sin(t * 0.6) * 0.15 * idle,
    cur.roll + Math.sin(t * 0.7) * 0.06 * idle
  );
  headVel.subVectors(headT, prevHeadT).divideScalar(Math.max(dt, 1 / 240)).clampScalar(-20, 20); prevHeadT.copy(headT);

  // lower body follows late and overshoots; leaning moves from the hips
  kickV.copy(headVel).multiplyScalar(-0.4 * dt);
  const w = waistSpring.step(dt, headT.clone().multiplyScalar(0.28), kickV);
  const hipTarget = headT.clone().multiplyScalar(0.1); hipTarget.z += -cur.tx * 0.32; hipTarget.x += cur.ty * 0.1;
  const hp = hipSpring.step(dt, hipTarget, kickV.clone().multiplyScalar(0.5));
  hip.rotation.set(hp.x, hp.y, hp.z);
  waist.rotation.set(w.x, w.y, w.z + Math.sin(t * 1.3) * 0.015);
  // the head always lands exactly where yours is
  head.rotation.set(headT.x - w.x - hp.x, headT.y - w.y - hp.y, headT.z - w.z - hp.z);

  // hop, spin, talk bounce, breathing
  hopV -= 12 * dt; hopY += hopV * dt;
  if (hopY <= 0) { if (hopV < -1) { squash = 0.18; kick = 6; } hopY = 0; hopV = 0; }
  squash *= Math.exp(-dt * 9);
  let spinY = 0;
  if (spinT >= 0) {
    spinT += dt / 0.7;
    const e = spinT >= 1 ? 1 : (spinT < 0.5 ? 2 * spinT * spinT : 1 - (-2 * spinT + 2) ** 2 / 2);
    spinY = e * Math.PI * 2; if (spinT >= 1) spinT = -1;
  }
  talkPhase += dt * 14 * cur.jaw;
  const talk = Math.abs(Math.sin(talkPhase)) * cur.jaw;
  const breathe = Math.sin(t * 1.8) * 0.012;
  const stretch = 1 + talk * 0.035 - squash + (hopV > 0 ? 0.06 : 0);
  hip.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
  waist.scale.set(1 + breathe, 1 - breathe * 0.5, 1 + breathe);
  head.position.y = (BONE_Y.head - BONE_Y.waist) + talk * 0.03;
  const depth = 1 + cur.tz;
  avatar.scale.setScalar(depth);
  avatar.position.set(cur.tx * 0.55, -0.15 + cur.ty * 0.6 + hopY + Math.sin(t * 1.6) * 0.02 * idle, 0);
  avatar.rotation.set(0, spinY, 0);

  // face
  const realOn = faceOpts.mode === 'real' && realFace.hasFrame && tracking;
  realFace.group.visible = realOn;
  cartoon.group.visible = !realOn;
  if (!realOn) cartoon.update(cur);

  // wardrobe animation (gets the head's total rotation)
  totalRot.x = hip.rotation.x + waist.rotation.x + head.rotation.x;
  totalRot.y = hip.rotation.y + waist.rotation.y + head.rotation.y + spinY;
  totalRot.z = hip.rotation.z + waist.rotation.z + head.rotation.z;
  for (const k of ['x', 'y', 'z']) { const v = (totalRot[k] - prevTotal[k]) / Math.max(dt, 1 / 240); drot[k] = isFinite(v) ? Math.max(-20, Math.min(20, v)) : 0; prevTotal[k] = totalRot[k]; }
  const st = { t, dt, jaw: cur.jaw, smile: cur.smile, rot: totalRot, drot, kick, visorDown, nvgDown, vest: !!(worn.body && worn.body.id !== 'none') };
  for (const s in worn) if (worn[s].update) { try { worn[s].update(st); } catch (e) { console.error(e); } }
  kick = 0;

  // steam (only when the top of the potato is showing)
  puffTimer -= dt;
  const steamy = worn.head && (worn.head.id === 'none' || worn.head.steam);
  if (steamy && puffTimer < 0) { spawnPuff(1); puffTimer = 0.35 + Math.random() * 0.3; }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const s = puffs[i], u = s.userData;
    u.age += dt;
    const k = u.age / u.life;
    s.position.y += u.vy * dt; s.position.x += (u.vx + Math.sin(u.age * 3 + i) * 0.08) * dt;
    s.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * u.peak;
    s.scale.setScalar(0.25 + k * 0.6);
    if (k >= 1) { s.parent.remove(s); s.material.dispose(); puffs.splice(i, 1); }
  }

  renderer.render(scene, camera);
}
animate();

// ---------- Touch buttons ----------
document.querySelectorAll('#touch [data-key]').forEach(b => b.addEventListener('click', e => {
  e.preventDefault(); dispatchEvent(new KeyboardEvent('keydown', { key: b.dataset.key })); b.blur();
}));
