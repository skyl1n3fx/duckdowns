/* powerups.js - cajas burbuja, bazooka, megafono, stun. Script clasico: window.DuckPowerups.
   Contrato: init(api), onRaceStart(start), update(dt,t), onNet(msg), onRaceEnd(). Ver PROTOCOLO.md. */
(function () {
'use strict';
const BOX_DP = 2.5, BOX_DX = 2, STUN_MS = 2000, IMMUNE_MS = 1000, RESPAWN_MS = 6000, ACT_GAP = 150;
const ITEMS = ['bazooka', 'megafono', 'gigante'];
const GIANT_MS = 8000, GIANT_SCALE = 3, BUMP_GAP = 2500;
let api = null, THREE = null, scene = null, audio = null, racing = false, startAt = 0;
let boxes = [], boxRoot = null, hud = null, hudIcon = null, stunTxt = null, poolsReady = false;
let TP, TD, TP2;                       // vectores temporales (sin allocations por frame)
let rngKind = Math.random, rngBox = null, shaking = 0;
const missiles = [], parts = [], rings = [], shoutSprites = [];
let G = {};                            // geometrias/materiales compartidos

/* ---------- sonidos (Web Audio via audio._tone/_air/thud del juego) ---------- */
const snd = {
  ok() { return audio && audio.ctx && !audio.muted; },
  pickup() { if (!this.ok()) return; [0, 1, 2].forEach(i => audio._tone(900 * Math.pow(1.25, i), [[0, 0.8], [0.3, 1.4], [1, 1]], 0.14, 0.4, { delay: i * 0.07, type: 'sine' })); },
  pop() { if (!this.ok()) return; audio._air(0.12, 0.25, 3200); audio._tone(1400, [[0, 1.4], [1, 0.6]], 0.1, 0.3, { type: 'sine' }); },
  thump() { if (!this.ok()) return; audio.thud(1.4); audio._air(0.25, 0.3, 700); },
  launch() { if (!this.ok()) return; audio.thud(1.2); audio._air(0.5, 0.4, 1200); audio._tone(500, [[0, 0.5], [1, 1.8]], 0.4, 0.3, { type: 'triangle', fm: 20, fmd: 60 }); },
  whistle() { if (!this.ok()) return; audio._tone(1100, [[0, 0.9], [0.5, 1.4], [1, 1]], 0.35, 0.18, { type: 'sine', fm: 30, fmd: 30 }); },
  boom() { if (!this.ok()) return; audio.boom(); audio.boing(); },
  bonk() { if (!this.ok()) return; audio.thud(1.3); audio._tone(300, [[0, 1.4], [0.3, 0.6], [0.6, 1.2], [1, 0.7]], 0.5, 0.5, { type: 'square', fm: 14, fmd: 90 }); },
  stars() { if (!this.ok()) return; for (let i = 0; i < 4; i++) audio._tone(1600 + i * 300, [[0, 1], [1, 0.9]], 0.12, 0.2, { delay: 0.15 + i * 0.1, type: 'sine' }); },
  shout() { // graznido amplificado con eco
    if (!this.ok()) return;
    for (let k = 0; k < 4; k++) {
      const g = 0.9 * Math.pow(0.5, k), d = k * 0.17;
      audio._tone(170 - k * 6, [[0, 1], [0.25, 1.9], [0.6, 1.0], [1, 1.5]], 0.5, g, { delay: d, fm: 24, fmd: 110 });
      audio._tone(230 - k * 8, [[0, 1], [1, 0.7]], 0.3, g * 0.6, { delay: d + 0.2, fm: 30, fmd: 90 });
    }
    audio._air(0.5, 0.25, 1500);
  },
  grow() { if (!this.ok()) return; audio.boing(); [0, 1, 2, 3].forEach(i => audio._tone(150 * Math.pow(1.26, i), [[0, 0.9], [0.3, 1.2], [1, 1]], 0.28, 0.5, { delay: i * 0.1, type: 'sawtooth', fm: 8, fmd: 30 })); audio._air(0.4, 0.25, 400); },
  shrink() { if (!this.ok()) return; [3, 2, 1, 0].forEach((k, i) => audio._tone(180 * Math.pow(1.26, k), [[0, 1.1], [1, 0.8]], 0.22, 0.4, { delay: i * 0.09, type: 'triangle' })); audio.squeak(0.8, 'release', 1.3); },
  stomp(v) { if (!this.ok()) return; audio.thud(1.6 * v); audio._air(0.3, 0.35 * v, 500); },
  ping() { if (!this.ok()) return; audio._tone(2400, [[0, 1], [1, 0.97]], 0.45, 0.4, { type: 'sine', fm: 0, fmd: 0 }); audio._tone(3700, [[0, 1], [1, 0.97]], 0.3, 0.2, { type: 'sine', delay: 0.02, fm: 0, fmd: 0 }); },
  miss() { if (!this.ok()) return; audio.splash(0.5); },
};

/* ---------- recursos compartidos ---------- */
function buildShared() {
  const T = THREE, M = (c, o) => new T.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
  G.sph = new T.SphereGeometry(1, 14, 10);
  G.sphLo = new T.SphereGeometry(1, 8, 6);
  G.star = new T.OctahedronGeometry(1, 0);
  G.ring = new T.RingGeometry(0.86, 1, 40);
  G.ring.rotateX(-Math.PI / 2);
  G.bubbleMats = [0xff9ad5, 0x7de3ff, 0xc3a6ff].map(c => new T.MeshPhysicalMaterial({
    color: c, transparent: true, opacity: 0.3, roughness: 0.05, clearcoat: 1, depthWrite: false, emissive: c, emissiveIntensity: 0.25 }));
  G.shine = M(0xffffff, { transparent: true, opacity: 0.85 });
  G.duckY = new T.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.35 });
  G.duckO = new T.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.3 });
  G.base = M(0xffffff, { transparent: true, opacity: 0.35, depthWrite: false });
  G.metal = new T.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.4, metalness: 0.5 });
  G.tube = new T.MeshStandardMaterial({ color: 0xff3d71, roughness: 0.35 });
  G.mega = new T.MeshStandardMaterial({ color: 0xffd200, roughness: 0.3 });
  G.megaIn = new T.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  G.ink = M(0x1b1230, { side: T.BackSide });
  const gl = c => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, c + 'cc'); gr.addColorStop(1, c + '00'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new T.SpriteMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false }); };
  G.glowMs = [gl('#ff6a9a'), gl('#ffd84a'), gl('#ffae2e')]; G.glowM = G.glowMs[0];
  G.dB = new T.SphereGeometry(0.36, 14, 10); G.dB.scale(1, 0.8, 1.15);
  G.dH = new T.SphereGeometry(0.2, 12, 9); G.dK = new T.SphereGeometry(0.1, 8, 6); G.dK.scale(1, 0.6, 1.4);
  G.arrowG = new T.ConeGeometry(0.13, 0.34, 8);
  G.pingM = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const c = cv.getContext('2d');
    c.font = '900 84px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 14; c.lineJoin = 'round';
    c.strokeStyle = '#1b3a5a'; c.strokeText('¡PING!', 128, 66); c.fillStyle = '#bfefff'; c.fillText('¡PING!', 128, 66);
    return new T.CanvasTexture(cv); })();
  G.bazG = new T.CylinderGeometry(0.075, 0.095, 0.95, 10); G.bazG.rotateX(Math.PI / 2);
  G.bazM = new T.CylinderGeometry(0.12, 0.08, 0.14, 10); G.bazM.rotateX(Math.PI / 2);
  G.megG = new T.CylinderGeometry(0.05, 0.27, 0.5, 14, 1, true); G.megG.rotateX(Math.PI / 2);
  G.megH = new T.CylinderGeometry(0.05, 0.05, 0.16, 8);
  G.misG = new T.CylinderGeometry(0.1, 0.1, 0.55, 8); G.misG.rotateX(Math.PI / 2);
  G.noseG = new T.ConeGeometry(0.1, 0.22, 8); G.noseG.rotateX(Math.PI / 2);
  G.finG = new T.BoxGeometry(0.22, 0.02, 0.14);
  // colores de particulas: material por color (compartidos)
  G.pm = [0xff4d4d, 0xffb02e, 0xfff04d, 0x4dff7a, 0x3aa0ff, 0xc77dff, 0xffffff, 0xff8ad8].map(c => M(c, { transparent: true }));
  for (let i = 0; i < 12; i++) G.pm.push(M(0xaab4c0, { transparent: true })); // humo (opacidad propia: ver partes)
}
function mkParts(n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(G.sphLo, G.pm[0]); m.visible = false; m.frustumCulled = false; scene.add(m);
    parts.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 0, g: 0, star: false, spin: 0 });
  }
}
let pi = 0;
function part(x, y, z, vx, vy, vz, life, s0, s1, mi, g, star) {
  const q = parts[pi]; pi = (pi + 1) % parts.length;
  q.m.geometry = star ? G.star : G.sphLo; q.m.material = G.pm[mi % G.pm.length];
  q.m.position.set(x, y, z); q.vx = vx; q.vy = vy; q.vz = vz; q.life = q.max = life; q.s0 = s0; q.s1 = s1; q.g = g; q.star = !!star;
  q.m.visible = true; q.m.scale.setScalar(s0);
  return q;
}
function mkRings(n) {
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(G.ring, mat); m.visible = false; m.frustumCulled = false; scene.add(m);
    rings.push({ m, life: 0, max: 1, r0: 1, r1: 6 });
  }
}
let ri = 0;
function ring(x, y, z, r0, r1, life, color) {
  const q = rings[ri]; ri = (ri + 1) % rings.length;
  q.m.position.set(x, y, z); q.life = q.max = life; q.r0 = r0; q.r1 = r1; q.m.material.color.setHex(color);
  q.m.visible = true; q.m.scale.setScalar(r0); q.m.material.opacity = 0.8;
}
function updFx(dt) {
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i]; if (q.life <= 0) continue;
    q.life -= dt;
    if (q.life <= 0) { q.m.visible = false; continue; }
    const u = 1 - q.life / q.max;
    q.vy -= q.g * dt;
    q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
    q.m.scale.setScalar(q.s0 + (q.s1 - q.s0) * u);
    if (q.star) { q.m.rotation.y += dt * 6; q.m.rotation.x += dt * 3; }
  }
  for (let i = 0; i < rings.length; i++) {
    const q = rings[i]; if (q.life <= 0) continue;
    q.life -= dt;
    if (q.life <= 0) { q.m.visible = false; continue; }
    const u = 1 - q.life / q.max;
    q.m.scale.setScalar(q.r0 + (q.r1 - q.r0) * u); q.m.material.opacity = 0.8 * (1 - u);
  }
}

/* ---------- iconos 3D toon (con contorno) de cada power-up ---------- */
function outlined(geo, mat, parent, x, y, z) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m);
  const o = new THREE.Mesh(geo, G.ink); o.position.set(x, y, z); o.scale.setScalar(1.16); parent.add(o);
  return m;
}
function iconGroup(kind) {
  const g = new THREE.Group();
  if (kind === 'bazooka') {
    g.rotation.z = 0.35;
    outlined(G.bazG, G.tube, g, 0, 0, 0); outlined(G.bazM, G.metal, g, 0, 0, -0.52); outlined(G.bazM, G.metal, g, 0, 0, 0.5);
    outlined(G.noseG, G.mega, g, 0, 0, -0.72);
    const gr = outlined(G.megH, G.metal, g, 0, -0.17, 0.15); gr.rotation.x = 0;
    g.scale.setScalar(1.5);
  } else if (kind === 'gigante') {
    outlined(G.dB, G.duckY, g, 0, -0.05, 0); outlined(G.dH, G.duckY, g, 0, 0.3, -0.2); outlined(G.dK, G.duckO, g, 0, 0.26, -0.4);
    const rots = [[0, 0], [0, Math.PI], [-Math.PI / 2, 0], [Math.PI / 2, 0], [0, 0, Math.PI / 2], [0, 0, -Math.PI / 2]];
    for (let i = 0; i < 6; i++) { const sg = new THREE.Group(), d = rots[i]; if (i < 4) sg.rotation.z = i === 0 ? 0 : i === 1 ? Math.PI : d[0]; else sg.rotation.x = d[2];
      outlined(G.arrowG, G.tube, sg, 0, 0.8, 0); g.add(sg); }
    g.scale.setScalar(1.7);
  } else {
    outlined(G.megG, G.mega, g, 0, 0, 0); outlined(G.megH, G.metal, g, 0, -0.16, 0.14);
    const ring = outlined(G.bazM, G.tube, g, 0, 0, 0.26); ring.scale.set(0.8, 0.8, 0.5);
    g.scale.setScalar(2.4);
  }
  g.visible = false;
  return g;
}
function setKind(o, k) { o.kind = k; o.baz.visible = k === 'bazooka'; o.meg.visible = k === 'megafono'; o.gig.visible = k === 'gigante'; o.glow.material = G.glowMs[k === 'bazooka' ? 0 : k === 'megafono' ? 1 : 2]; }

/* ---------- cajas: burbuja de jabon con el icono del power-up ---------- */
function makeBox(b, idx) {
  const T = THREE, g = new T.Group(), inner = new T.Group();
  const bub = new T.Mesh(G.sph, G.bubbleMats[idx % 3]); bub.scale.setScalar(0.95); g.add(bub);
  const baz = iconGroup('bazooka'), meg = iconGroup('megafono'), gig = iconGroup('gigante');
  inner.add(baz); inner.add(meg); inner.add(gig);
  const glow = new T.Sprite(G.glowM); glow.scale.set(2.3, 2.3, 1); glow.position.y = 0; g.add(glow);
  g.add(inner);
  for (let i = 0; i < 3; i++) { // destellos de la burbuja
    const s = new T.Mesh(G.sphLo, G.shine); const a = i * 2.1; s.scale.setScalar(0.07 - i * 0.015);
    s.position.set(Math.cos(a) * 0.5, 0.55 - i * 0.2, Math.sin(a) * 0.5 - 0.35); g.add(s);
  }
  const base = new T.Mesh(G.ring, G.base); base.position.y = -1.0; base.scale.setScalar(0.9); g.add(base);
  g.visible = false; boxRoot.add(g);
  const o = { id: b.id, p: b.p, x: b.x, active: true, g, inner, bub, base, baz, meg, gig, glow, kind: null, ph: idx * 1.7, sc: 1, back: 0, pos: new T.Vector3() };
  setKind(o, b.kind || ITEMS[b.id % 3]);
  return o;
}
function setBoxes(list) {
  for (const o of boxes) boxRoot.remove(o.g);
  boxes = list.map((b, i) => makeBox(b, i));
  for (const o of boxes) { api.trackToWorld(o.p, o.x, TP, TD); o.pos.copy(TP); o.g.position.set(TP.x, 1.35, TP.z); }
}
function genOfflineBoxes(seed) {   // misma regla que el servidor (filas de 3), RNG local
  const R = api.rng((seed ^ 0x5bd1e995) >>> 0), out = [], L = api.consts.LENGTH;
  const rows = Math.min(10, Math.max(3, Math.round((L - 100) / 130) + 1)), span = L - 100;
  for (let i = 0; i < rows; i++) {
    const edge = i === 0 || i === rows - 1, base = 60 + span * i / (rows - 1);
    const p = Math.round(Math.min(L - 40, Math.max(60, base + (edge ? 0 : (R() - 0.5) * 12))) * 10) / 10;
    for (const x0 of [-6, 0, 6]) out.push({ id: out.length, p, x: Math.round((x0 + (R() - 0.5) * 3) * 10) / 10 });
  }
  const K = api.rng((seed ^ 0x1234abcd) >>> 0);
  for (const b of out) b.kind = ITEMS[(K() * ITEMS.length) | 0];
  return out;
}
function updBoxes(dt, t) {
  const mp = api.me ? api.me.p : 0;
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (Math.abs(o.p - mp) > 130) { o.g.visible = false; continue; }
    o.sc += ((o.active ? 1 : 0) - o.sc) * Math.min(1, dt * 8);
    o.g.visible = o.sc > 0.02;
    if (!o.g.visible) continue;
    const k = 1.7 * o.sc * (1 + Math.sin(t * 3 + o.ph) * 0.04);
    o.g.scale.setScalar(k);
    o.g.position.y = 1.35 + Math.sin(t * 1.8 + o.ph) * 0.18;
    o.inner.rotation.y = t * 1.6 + o.ph; o.inner.position.y = Math.sin(t * 2.6 + o.ph) * 0.06;
    o.glow.material.opacity = 0.7 + Math.sin(t * 3 + o.ph) * 0.3;
    o.bub.scale.set(0.95 + Math.sin(t * 4 + o.ph) * 0.03, 0.95 - Math.sin(t * 4 + o.ph) * 0.03, 0.95);
    o.base.rotation.y = t * 0.8;
  }
}
function boxPop(o) {
  snd.pop();
  const x = o.pos.x, y = 1.5, z = o.pos.z;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 6.283;
    part(x, y, z, Math.cos(a) * 3, 1.5 + Math.random() * 2, Math.sin(a) * 3, 0.6, 0.18, 0, (i % 3) + 4, 6, false);
  }
  ring(x, 0.1, z, 0.5, 3.5, 0.5, 0xbfefff);
}

/* ---------- accesorios visibles y estado por pato ---------- */
function puOf(r) {
  if (r._pu) return r._pu;
  const T = THREE, bob = r.duck.bob, root = r.duck.root;
  const baz = new T.Group(); baz.position.set(0.34, 0.6, -0.02); baz.scale.setScalar(1.35); baz.visible = false;
  const tube = new T.Mesh(G.bazG, G.tube); baz.add(tube);
  const mz = new T.Mesh(G.bazM, G.metal); mz.position.z = -0.5; baz.add(mz);
  const bk = new T.Mesh(G.bazM, G.metal); bk.position.z = 0.48; baz.add(bk);
  bob.add(baz);
  const meg = new T.Group(); meg.position.set(0, 0.68, -0.6); meg.scale.setScalar(1.3); meg.visible = false;
  meg.add(new T.Mesh(G.megG, G.mega));
  const h = new T.Mesh(G.megH, G.metal); h.position.set(0, -0.14, 0.12); meg.add(h);
  bob.add(meg);
  const starG = new T.Group(); starG.visible = false; starG.position.y = 0.95; root.add(starG);
  const stars = [];
  for (let i = 0; i < 3; i++) { const s = new T.Mesh(G.star, G.pm[2]); s.scale.setScalar(0.1); starG.add(s); stars.push(s); }
  const aura = new T.Sprite(new T.SpriteMaterial({ map: G.glowMs[2].map, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); aura.position.y = 0.7; aura.scale.set(3.4, 3.4, 1); aura.visible = false; root.add(aura);
  r._pu = { aura, giantSeen: 0, giantOn: false, giantT0: 0, wave: 0, shrunk: false, bumped: [0, 0, 0, 0, 0, 0, 0, 0], launch: false, baz, meg, starG, stars, recoil: 0, pulse: 0, stunSeen: 0, stunT0: 0, immuneUntil: 0, botAt: 0, lastSend: 0, yawOn: false, hop: 0 };
  return r._pu;
}
function getItemIcon(kind) {
  if (kind === 'bazooka') return '<svg viewBox="0 0 64 64" width="52" height="52"><rect x="6" y="26" width="42" height="12" rx="6" fill="#ff3d71" stroke="#1b1230" stroke-width="3"/><rect x="44" y="23" width="12" height="18" rx="4" fill="#3a3f4b"/><rect x="14" y="38" width="8" height="12" rx="3" fill="#3a3f4b"/><circle cx="58" cy="32" r="3" fill="#ffd23a"/></svg>';
  if (kind === 'megafono') return '<svg viewBox="0 0 64 64" width="52" height="52"><path d="M10 26h10l26-14v40L20 38H10z" fill="#ffd200" stroke="#1b1230" stroke-width="3"/><rect x="20" y="38" width="8" height="14" rx="3" fill="#3a3f4b"/><path d="M52 24q6 8 0 16M56 18q10 14 0 28" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
  if (kind === 'gigante') return '<svg viewBox="0 0 64 64" width="52" height="52"><ellipse cx="30" cy="40" rx="17" ry="13" fill="#ffd23a" stroke="#1b1230" stroke-width="3"/><circle cx="38" cy="22" r="10" fill="#ffd23a" stroke="#1b1230" stroke-width="3"/><ellipse cx="49" cy="25" rx="6" ry="3.5" fill="#ff6a00" stroke="#1b1230" stroke-width="2"/><path d="M8 8l8 2-6 6zM56 8l-8 2 6 6zM8 58l6-8 2 8zM56 58l-6-8-2 8z" fill="#ff3d71" stroke="#1b1230" stroke-width="2" stroke-linejoin="round"/></svg>';
  return '';
}
function buildHud() {
  hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;left:50%;bottom:56px;transform:translateX(-50%);width:84px;height:84px;border-radius:50%;' +
    'background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.55),rgba(150,220,255,.28));border:3px solid rgba(255,255,255,.8);' +
    'box-shadow:0 6px 18px rgba(0,0,0,.25);display:none;align-items:center;justify-content:center;pointer-events:none;z-index:6;font:700 11px system-ui,sans-serif;color:#fff';
  hudIcon = document.createElement('div'); hud.appendChild(hudIcon);
  const lb = document.createElement('div'); lb.textContent = 'CLIC'; lb.style.cssText = 'position:absolute;bottom:-18px;left:0;right:0;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.6);letter-spacing:1px';
  hud.appendChild(lb);
  stunTxt = document.createElement('div'); stunTxt.textContent = '¡Aturdido!';
  stunTxt.style.cssText = 'position:absolute;left:0;right:0;top:32%;text-align:center;font:900 clamp(34px,7vw,72px) system-ui,sans-serif;color:#ffe14d;-webkit-text-stroke:3px #7a3b00;text-shadow:0 6px 0 #7a3b00;pointer-events:none;display:none;z-index:7';
  api.hudRoot.appendChild(hud); api.hudRoot.appendChild(stunTxt);
}
let hudKind = null;
function refreshHud() {
  const k = api.me ? api.me.item : null;
  if (k === hudKind) return;
  hudKind = k; hud.style.display = k ? 'flex' : 'none'; hudIcon.innerHTML = k ? getItemIcon(k) : '';
}

/* ---------- utilidades ---------- */
function bySlot(slot) { const R = api.racers; for (let i = 0; i < R.length; i++) if (R[i].slot === slot) return R[i]; return null; }
function wpos(r, out) { out.copy(r.duck.root.position); return out; }

/* ---------- stun ---------- */
function startStun(r, pu) {
  const R = api.racers; pu.launch = false;
  for (let i = 0; i < R.length; i++) if (R[i] !== r && api.now() < (R[i].giantUntil || 0) && Math.hypot(R[i].p - r.p, R[i].x - r.x) < 8) pu.launch = true;
  snd.bonk(); snd.stars(); if (pu.launch) { audio && audio.boing && audio.boing(); }
  const p = r.duck.root.position;
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; part(p.x, 0.9, p.z, Math.cos(a) * 2, 2 + Math.random(), Math.sin(a) * 2, 0.7, 0.14, 0, 2, 6, true); }
  ring(p.x, 0.1, p.z, 0.6, 3, 0.6, 0xfff3a0);
  pu.starG.visible = true;
}
function updStun(r, pu, n, t, isMe) {
  const su = r.stunUntil || 0;
  if (su > n) {
    if (pu.stunSeen !== su) { pu.stunSeen = su; pu.stunT0 = su - STUN_MS; pu.immuneUntil = su + IMMUNE_MS; startStun(r, pu); }
    const e = (n - pu.stunT0) / 1000, u = Math.min(1, Math.max(0, e / (STUN_MS / 1000)));
    const hop = pu.launch ? (e < 0.8 ? Math.sin(e / 0.8 * Math.PI) * 3.2 : 0) : (e < 0.32 ? Math.sin(e / 0.32 * Math.PI) * 0.9 : 0);
    const bob = r.duck.bob;
    bob.position.y += hop;
    bob.rotation.y = 4 * 6.2831853 * (1 - (1 - u) * (1 - u));   // 4 vueltas frenando; termina en la orientacion original
    bob.rotation.z += Math.sin(t * 22) * 0.12 * (1 - u);
    pu.yawOn = true;
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + i * 2.094, s = pu.stars[i];
      s.position.set(Math.cos(a) * 0.4, Math.sin(t * 7 + i) * 0.05, Math.sin(a) * 0.4); s.rotation.y = t * 6;
    }
    if (isMe) {
      api.fx.camLock = true; stunTxt.style.display = 'block';
      stunTxt.style.transform = 'rotate(' + (Math.sin(t * 14) * 3) + 'deg) scale(' + (1 + Math.sin(t * 10) * 0.05) + ')';
      const a = 0.35 * (1 - u * 0.7);
      api.fx.shakeX = (Math.random() - 0.5) * a; api.fx.shakeY = (Math.random() - 0.5) * a;
    }
  } else if (pu.yawOn) {
    pu.yawOn = false; r.duck.bob.rotation.y = 0; pu.starG.visible = false;
    if (isMe) { stunTxt.style.display = 'none'; api.fx.camLock = false; }
  }
}

/* ---------- misil teledirigido ---------- */
function makeMissile() {
  const T = THREE, g = new T.Group();
  g.add(new T.Mesh(G.misG, G.tube));
  const nose = new T.Mesh(G.noseG, G.mega); nose.position.z = 0.38; g.add(nose);
  for (let i = 0; i < 3; i++) { const f = new T.Mesh(G.finG, G.metal); f.rotation.z = i * 2.094; f.position.z = -0.22; g.add(f); }
  g.visible = false; scene.add(g);
  return { g, on: false, from: null, tgt: null, p0: 0, x0: 0, u: 0, eta: 1, lx: 0, ly: 0, lz: 0, hit: 0 };
}
function showMissile(from, tgt, eta) {
  let m = null;
  for (let i = 0; i < missiles.length; i++) if (!missiles[i].on) { m = missiles[i]; break; }
  if (from) { const pu = puOf(from); pu.recoil = 0.35; }
  snd.launch();
  if (from) { const q = from.duck.root.position; part(q.x, 0.9, q.z, 0, 1, 0, 0.5, 0.5, 0, 6, 0); ring(q.x, 0.15, q.z, 0.4, 2.2, 0.4, 0xffd9a0); }
  if (!m) return;
  m.on = true; m.from = from; m.tgt = tgt; m.p0 = from ? from.p : 0; m.x0 = from ? from.x : 0; m.u = 0; m.eta = tgt ? Math.max(0.5, eta || 1) : 0.9;
  m.g.visible = true; m.lx = m.lz = 0; m.ly = -1; m.hit = 0; m.sc = 0;
}
function explode(x, y, z, near) {
  snd.boom();
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * 6.283, v = 2 + Math.random() * 5;
    part(x, y, z, Math.cos(a) * v, 2 + Math.random() * 5, Math.sin(a) * v, 0.8, 0.28, 0, i % 3 === 0 ? 1 : (i % 3 === 1 ? 2 : 7), 9, false);
  }
  ring(x, 0.12, z, 0.8, 6, 0.6, 0xffe27a); ring(x, 0.12, z, 0.4, 3.5, 0.45, 0xff8ad8);
  if (near) api.shake(0.5);
}
function updMissiles(dt, t) {
  for (let i = 0; i < missiles.length; i++) {
    const m = missiles[i]; if (!m.on) continue;
    m.u += dt / m.eta;
    const u = Math.min(1, m.u), tg = m.tgt;
    let tp, tx;
    if (tg) { tp = tg.p; tx = tg.x; } else { tp = m.p0 + 40; tx = m.x0; }
    const e = Math.pow(u, 1.4);
    const mp = m.p0 + (tp - m.p0) * e, mx = m.x0 + (tx - m.x0) * e + Math.sin(u * 6.283) * 1.8 * (1 - u);
    api.trackToWorld(mp, mx, TP, TD);
    const y = 0.8 + Math.sin(u * Math.PI) * 1.5;
    m.g.position.set(TP.x, y, TP.z);
    if (m.ly > -0.5) { TP2.set(TP.x - m.lx, y - m.ly, TP.z - m.lz); if (TP2.lengthSq() > 1e-6) { TP2.add(m.g.position); m.g.lookAt(TP2); } }
    m.lx = TP.x; m.ly = y; m.lz = TP.z;
    m.sc = Math.min(1, m.sc + dt * 8); m.g.scale.setScalar(m.sc);
    // estela de humo colorido
    const c = ((t * 14) | 0) % 6;
    part(TP.x, y, TP.z, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, 0.7, 0.34, 0, c, 0, false);
    if (((t * 40) | 0) % 3 === 0) part(TP.x, y, TP.z, 0, 0.1, 0, 0.5, 0.2, 0, 6, 0, false);
    if (m.u >= 1) {
      m.on = false; m.g.visible = false;
      if (tg && api.now() < (tg.giantUntil || 0)) showPing(tg);
      else if (tg) { const q = tg.duck.root.position; explode(q.x, Math.max(0.6, q.y + 0.7), q.z, tg === api.me); }
      else explode(TP.x, 0.5, TP.z, false);
    }
  }
}

/* ---------- gigante ---------- */
const elOut = u => u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * 2.0943951) + 1;
function updGiant(r, pu, n, t, dt) {
  const gu = r.giantUntil || 0, root = r.duck.root;
  if (gu > n) {
    if (pu.giantSeen !== gu) { pu.giantSeen = gu; pu.giantT0 = gu - GIANT_MS; pu.giantOn = true; pu.shrunk = false; pu.wave = 0; snd.grow(); const q = root.position; ring(q.x, 0.12, q.z, 1, 9, 0.8, 0xffd84a); ring(q.x, 0.12, q.z, 1, 6, 0.6, 0xffffff); }
    const e = (n - pu.giantT0) / 1000, left = (gu - n) / 1000;
    let sc;
    if (left < 0.6) { const k = 1 - left / 0.6; sc = 1 + (GIANT_SCALE - 1) * (1 - k * k * (3 - 2 * k)) - Math.sin(k * Math.PI) * 0.15; if (!pu.shrunk) { pu.shrunk = true; snd.shrink(); } }
    else sc = 1 + (GIANT_SCALE - 1) * Math.min(1.12, elOut(Math.min(1, e / 0.7)));
    r.giantScale = sc; root.scale.setScalar(sc);
    pu.aura.visible = true; pu.aura.material.opacity = 0.35 + Math.sin(t * 6) * 0.15;
    if (e > 0.7 && (pu.wave -= dt) <= 0 && r.vp > 1) {      // pisadas: olas en el agua
      pu.wave = 0.3; const q = root.position; ring(q.x, 0.12, q.z, 1.2, 7, 0.7, 0xdff6ff);
      for (let i = 0; i < 6; i++) { const a = Math.random() * 6.283; part(q.x + Math.cos(a), 0.2, q.z + Math.sin(a), Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3, 0.6, 0.18, 0, 6, 12, false); }
      if (r === api.me || Math.abs(r.p - api.me.p) < 30) snd.stomp(r === api.me ? 1 : 0.5);
      if (r === api.me) api.shake(0.12);
    }
  } else if (pu.giantOn) {
    pu.giantOn = false; r.giantScale = 1; root.scale.setScalar(1); pu.aura.visible = false;
  }
}
// offline: el gigante embiste a los patos dentro del radio y los aturde (online lo decide el servidor)
function giantBumps(r, pu, n) {
  if (n >= (r.giantUntil || 0)) return;
  const R = api.racers, rad = api.consts.GIANT_BUMP_R || 4;
  for (let i = 0; i < R.length; i++) {
    const q = R[i]; if (q === r || q.finished || q.dead || n < (q.giantUntil || 0) || n < pu.bumped[q.slot & 7]) continue;
    if (Math.hypot(q.p - r.p, q.x - r.x) > rad) continue;
    pu.bumped[q.slot & 7] = n + BUMP_GAP;
    stunLocal(q, n);
  }
}

/* ---------- megafono ---------- */
function makeShoutSprites() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d'); c.font = '900 110px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 16; c.strokeStyle = '#7a1d00'; c.lineJoin = 'round'; c.strokeText('¡CUAAAC!', 256, 84);
  c.fillStyle = '#ffd200'; c.fillText('¡CUAAAC!', 256, 84);
  const tex = new THREE.CanvasTexture(cv);
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 }));
    sp.visible = false; sp.scale.set(4.2, 1.31, 1); sp.renderOrder = 20; scene.add(sp);
    shoutSprites.push({ sp, life: 0, y0: 0 });
  }
}
function showShout(from, px, py) {
  const q = from ? from.duck.root.position : null;
  const x = q ? q.x : px, z = q ? q.z : py, y = q ? q.y : 0;
  if (from) puOf(from).pulse = 1;
  snd.shout();
  ring(x, 0.14, z, 1, 14, 1.0, 0xfff07a); ring(x, 0.14, z, 1, 11, 0.85, 0xffffff); ring(x, 0.14, z, 1, 8, 0.7, 0xffb347);
  for (let i = 0; i < 3; i++) {
    const s = shoutSprites[i]; if (s.life > 0) continue;
    s.life = 1.3; s.y0 = y + 2.4; s.sp.position.set(x, s.y0, z); s.sp.visible = true; break;
  }
  api.shake(0.15);
}
const pingSprites = [];
function showPing(r) {
  snd.ping();
  const q = r.duck.root.position, k = r.giantScale || 1;
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; part(q.x, 1.2 * k, q.z, Math.cos(a) * 4, 3 + Math.random() * 2, Math.sin(a) * 4, 0.5, 0.2, 0, 6, 8, true); }
  for (let i = 0; i < pingSprites.length; i++) { const s = pingSprites[i]; if (s.life > 0) continue; s.life = 0.9; s.x = q.x; s.y = 2.2 * k; s.z = q.z; s.sp.visible = true; break; }
}
function updPing(dt) {
  for (let i = 0; i < pingSprites.length; i++) {
    const s = pingSprites[i]; if (s.life <= 0) continue;
    s.life -= dt; if (s.life <= 0) { s.sp.visible = false; continue; }
    const u = 1 - s.life / 0.9, k = 1 + Math.sin(Math.min(1, u * 3) * Math.PI) * 0.35;
    s.sp.position.set(s.x, s.y + u * 1.2, s.z); s.sp.scale.set(2.4 * k, 1.2 * k, 1); s.sp.material.opacity = u > 0.6 ? (1 - u) / 0.4 : 1;
  }
}
function updShout(dt) {
  for (let i = 0; i < shoutSprites.length; i++) {
    const s = shoutSprites[i]; if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.sp.visible = false; continue; }
    const u = 1 - s.life / 1.3, k = u < 0.2 ? 0.5 + u / 0.2 * 0.7 : 1.2 - (u - 0.2) * 0.25;
    s.sp.scale.set(4.2 * k, 1.31 * k, 1); s.sp.position.y = s.y0 + u * 1.5;
    s.sp.material.opacity = u > 0.7 ? (1 - u) / 0.3 : 1;
  }
}

/* ---------- reglas locales (offline) = mismas que el servidor ---------- */
function stunLocal(r, n) {
  const pu = puOf(r);
  if (n < (r.giantUntil || 0)) { showPing(r); return false; }
  if (n < pu.immuneUntil || n < (r.stunUntil || 0) || n < (r.airUntil || 0)) return false;
  r.stunUntil = n + STUN_MS; pu.immuneUntil = r.stunUntil + IMMUNE_MS; return true;
}
function targetAhead(r) { // el pato con menor p mayor que el mio
  let best = null, bp = 1e9; const R = api.racers;
  for (let i = 0; i < R.length; i++) { const q = R[i]; if (q === r || q.finished || q.dead) continue; if (q.p > r.p && q.p < bp) { best = q; bp = q.p; } }
  return best;
}
const pending = [];   // impactos de misiles locales: {at, tgt, from}
function fireLocal(r, kind) {
  const n = api.now();
  if (kind === 'gigante') { r.giantUntil = n + GIANT_MS; return; }
  if (kind === 'megafono') {
    showShout(r, 0, 0);
    const near = [], R = api.racers;
    for (let i = 0; i < R.length; i++) { const q = R[i]; if (q === r || q.finished || q.dead) continue; near.push({ q, d: Math.hypot(q.p - r.p, q.x - r.x) }); }
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < 3 && i < near.length; i++) stunLocal(near[i].q, n);
    return;
  }
  const tg = targetAhead(r);
  const eta = tg ? Math.min(1.6, Math.max(0.6, 0.6 + (tg.p - r.p) / 50)) : 0;
  showMissile(r, tg, eta);
  if (tg) pending.push({ at: n + eta * 1000, tgt: tg });
}
function pickLocal(r, o, n) {
  o.active = false; o.back = n + RESPAWN_MS; boxPop(o);
  r.item = o.kind || ITEMS[(Math.random() * ITEMS.length) | 0]; puOf(r).botAt = n + 1000 + Math.random() * 3500;
  if (r === api.me) snd.pickup();
}

/* ---------- acciones: pickup / fire ---------- */
function fireR(r) {
  const k = r.item; if (!k) return;
  r.item = null;
  if (api.isOnline()) { const m = { t: 'fire' }; if (r !== api.me) m.slot = r.slot; api.send(m); }
  else fireLocal(r, k);
}
function canAct() { if (window.__game && window.__game.state !== 'race') return false; return racing && api.me && api.now() >= startAt && !(api.me.finished); }
function onMouse(e) {
  if (e.button !== 0 || !canAct() || !api.me.item) return;
  const tg = e.target;
  if (tg && tg.closest && tg.closest('button,input,select,textarea,a,.btn,.ov,[role=button]')) return;
  if (api.now() < (api.me.stunUntil || 0)) return;
  fireR(api.me);
}
function tryPickups(r, pu, n) {
  if (r.item || n < pu.lastSend) return;
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (!o.active || Math.abs(o.p - r.p) >= BOX_DP || Math.abs(o.x - r.x) >= BOX_DX) continue;
    if (api.isOnline()) { const m = { t: 'pickup', box: o.id }; if (r !== api.me) m.slot = r.slot; api.send(m); pu.lastSend = n + 300; }
    else pickLocal(r, o, n);
    return;
  }
}
function botLogic(r, pu, n) {
  if (!r.item || n < pu.botAt || n < (r.stunUntil || 0)) return;
  if (Math.random() < 0.02) return;      // algo de azar: duda un poco
  let ok = false; const R = api.racers;
  for (let i = 0; i < R.length; i++) {
    const q = R[i]; if (q === r || q.finished || q.dead) continue;
    if (r.item === 'gigante') { if (n >= (r.giantUntil || 0) && Math.hypot(q.p - r.p, q.x - r.x) < 30) { ok = true; break; } continue; }
    if (r.item === 'megafono' ? Math.hypot(q.p - r.p, q.x - r.x) < 14 : (q.p > r.p && q.p - r.p < 90)) { ok = true; break; }
  }
  if (ok) fireR(r); else pu.botAt = n + 400;
}

/* ---------- ciclo ---------- */
function update(dt, t) {
  if (!api) return;
  const n = api.now(), fx = api.fx, R = api.racers, me = api.me;
  fx.camLock = false; fx.shakeX = 0; fx.shakeY = 0;
  updBoxes(dt, t);
  if (!api.isOnline()) for (let i = 0; i < boxes.length; i++) { const o = boxes[i]; if (!o.active && o.back && n >= o.back) { o.active = true; setKind(o, ITEMS[(rngKind() * ITEMS.length) | 0]); } }
  for (let i = pending.length - 1; i >= 0; i--) {
    const q = pending[i]; if (n < q.at) continue;
    pending.splice(i, 1); stunLocal(q.tgt, n);
  }
  const live = racing && n >= startAt;
  for (let i = 0; i < R.length; i++) {
    const r = R[i], pu = puOf(r);
    pu.baz.visible = r.item === 'bazooka'; pu.meg.visible = r.item === 'megafono';
    if (pu.recoil > 0) { pu.recoil = Math.max(0, pu.recoil - dt * 1.8); pu.baz.position.z = -0.02 + pu.recoil; }
    if (pu.pulse > 0) { pu.pulse = Math.max(0, pu.pulse - dt * 2.5); pu.meg.scale.setScalar(1.3 * (1 + pu.pulse * 0.5)); }
    updGiant(r, pu, n, t, dt);
    updStun(r, pu, n, t, r === me);
    if (live && !r.finished && !r.dead && api.isSim(r)) {
      tryPickups(r, pu, n);
      if (!api.isOnline()) giantBumps(r, pu, n);
      if (r.kind === 'bot') botLogic(r, pu, n);
    }
  }
  updMissiles(dt, t); updShout(dt); updPing(dt); updFx(dt);
  if (me && me.giantScale > 1) fx.camUp += (me.giantScale - 1) * 0.8;
  refreshHud();
}
function onNet(m) {
  if (!api) return;
  let r, o;
  switch (m.t) {
    case 'item': r = bySlot(m.slot); if (r) { r.item = m.kind; puOf(r).botAt = api.now() + 1000 + Math.random() * 3500; if (r === api.me) snd.pickup(); } break;
    case 'boxTaken': o = boxes[m.box]; if (o) { o.active = false; boxPop(o); } break;
    case 'boxBack': o = boxes[m.box]; if (o) { o.active = true; if (m.kind) setKind(o, m.kind); } break;
    case 'missile': showMissile(bySlot(m.from), m.target == null ? null : bySlot(m.target), m.eta); break;
    case 'shout': r = bySlot(m.from); if (r) showShout(r, 0, 0);
      if (m.targets) for (let i = 0; i < m.targets.length; i++) { const q = bySlot(m.targets[i]); if (q && api.now() < (q.giantUntil || 0)) showPing(q); }
      break;
    case 'giant': r = bySlot(m.slot); if (r) r.giantUntil = m.until; break;
    case 'stun': r = bySlot(m.slot); if (r) r.stunUntil = m.until; break;
    case 'miss': snd.miss(); break;
  }
}
function clearRacers() {
  const R = api.racers;
  for (let i = 0; i < R.length; i++) { const r = R[i], pu = puOf(r); r.item = null; r.stunUntil = 0; r.giantUntil = 0; r.giantScale = 1; r.duck.root.scale.setScalar(1); pu.aura.visible = false; pu.giantOn = false; pu.giantSeen = 0; pu.bumped.fill(0); pu.immuneUntil = 0; pu.stunSeen = 0; pu.baz.visible = pu.meg.visible = false; }
  for (let i = 0; i < missiles.length; i++) { missiles[i].on = false; missiles[i].g.visible = false; }
  pending.length = 0;
}
function onRaceStart(st) {
  racing = true; startAt = (st && st.startAt) || 0;
  clearRacers();
  const list = st && st.boxes ? st.boxes : genOfflineBoxes((st && st.seed) | 0);
  setBoxes(list);
  rngKind = api.rng(((st && st.seed) ^ 0x7777aaaa) >>> 0);
}
function onRaceEnd() {
  racing = false;
  if (!api) return;
  clearRacers();
  stunTxt.style.display = 'none'; api.fx.camLock = false;
}
function init(a) {
  api = a; THREE = a.THREE; scene = a.scene; audio = a.audio;
  TP = new THREE.Vector3(); TD = new THREE.Vector3(); TP2 = new THREE.Vector3();
  api.fx = api.fx || { camUp: 0, camLock: false, shakeX: 0, shakeY: 0 };
  buildShared(); mkParts(220); mkRings(12);
  boxRoot = new THREE.Group(); scene.add(boxRoot);
  for (let i = 0; i < 4; i++) missiles.push(makeMissile());
  makeShoutSprites(); buildHud();
  for (let i = 0; i < 3; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.pingM, transparent: true, depthTest: false, opacity: 0 })); sp.visible = false; sp.renderOrder = 21; scene.add(sp); pingSprites.push({ sp, life: 0, x: 0, y: 0, z: 0 }); }
  const sq = audio.squeak; audio.squeak = function (a, b, c) { return sq.call(this, a, b, (c || 1) * (api.me && api.now() < (api.me.giantUntil || 0) ? 0.55 : 1)); };   // voz grave de gigante
  window.addEventListener('mousedown', onMouse);
}
window.DuckPowerups = { init, update, onNet, onRaceStart, onRaceEnd, _fireR: fireR, ping: showPing, _boxes: () => boxes };
})();
