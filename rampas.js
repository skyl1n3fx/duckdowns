/* rampas.js - rampas toon sobre el rio y el salto de ~1 s. Script clasico: window.DuckRamps.
   Contrato: init(api), onRaceStart(start), update(dt,t), onNet(msg), onRaceEnd(). El servidor decide el salto (msg 'jump'); offline se detecta aqui. */
(function () {
'use strict';
let JUMP_MS = 1000;
const LEN = 5.2, H = 1.35, PEAK_MIN = 1.6, PEAK_MAX = 3.6, TOP = H - 0.08, SLOPE = Math.atan(H / LEN);
const COLS = [[0xff4d6d, 0xffd6e0], [0x2ec4f1, 0xd6f5ff], [0xffb703, 0xfff0c2], [0x7bd957, 0xe3ffd6], [0xb57bff, 0xeadcff], [0xff7f3f, 0xffe1cf], [0x00d1b2, 0xcffff4], [0xff5fa8, 0xffe0f0]];
let api = null, THREE = null, scene = null, audio = null, racing = false;
let ramps = [], root = null, TP, TD, G = {}, offRamps = [];
const drops = [], rips = [];

/* ---------- sonidos ---------- */
const snd = {
  ok() { return audio && audio.ctx && !audio.muted; },
  boing() { if (this.ok()) { audio.boing(); audio._tone(700, [[0, 0.6], [0.4, 1.7], [1, 1.2]], 0.3, 0.3, { type: 'sine', delay: 0.04 }); } },
  land() { if (!this.ok()) return; audio.splash(1.2); audio.thud(0.8); audio._tone(1500, [[0, 1.5], [0.4, 1.0], [1, 0.7]], 0.28, 0.45, { delay: 0.05, fm: 55, fmd: 60 }); audio.squeak(1.3, 'squeeze', 1.5); },
};

/* ---------- geometria compartida: cuña toon con franjas ---------- */
function buildWedge() {
  const N = 6, top0 = [], top1 = [], side = [];
  const V = (x, y, z) => [x, y, z];
  const quad = (arr, a, b, c, d) => arr.push(a, b, c, a, c, d);
  for (let i = 0; i < N; i++) {
    const z0 = 1 - i / N, z1 = 1 - (i + 1) / N, y0 = 1 - z0, y1 = 1 - z1;   // z=1 atras (bajo), z=0 labio (alto)
    quad(i % 2 ? top1 : top0, V(-0.5, y0, z0), V(0.5, y0, z0), V(0.5, y1, z1), V(-0.5, y1, z1));
  }
  side.push(V(-0.5, 0, 1), V(-0.5, 1, 0), V(-0.5, 0, 0), V(0.5, 0, 1), V(0.5, 0, 0), V(0.5, 1, 0));   // flancos
  quad(side, V(-0.5, 0, 0), V(-0.5, 1, 0), V(0.5, 1, 0), V(0.5, 0, 0));                               // frente del labio
  const all = top0.concat(top1, side), pos = new Float32Array(all.length * 3);
  all.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.addGroup(0, top0.length, 0); g.addGroup(top0.length, top1.length, 1); g.addGroup(top0.length + top1.length, side.length, 2);
  g.computeVertexNormals();
  return g;
}
function buildShared() {
  const T = THREE, tone = new Uint8Array([70, 70, 70, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  const gm = new T.DataTexture(tone, 3, 1, T.RGBAFormat); gm.minFilter = gm.magFilter = T.NearestFilter; gm.needsUpdate = true;
  G.wedge = buildWedge();
  G.mats = COLS.map(c => [new T.MeshToonMaterial({ color: c[0], gradientMap: gm }), new T.MeshToonMaterial({ color: c[1], gradientMap: gm }), new T.MeshToonMaterial({ color: 0x35324a, gradientMap: gm })]);
  G.arrowG = new T.ConeGeometry(0.4, 0.8, 4); G.arrowG.rotateX(-Math.PI / 2);   // punta hacia -z (adelante)
  G.arrowM = COLS.map(c => new T.MeshBasicMaterial({ color: c[0] }));
  G.sph = new T.SphereGeometry(1, 7, 5);
  G.dropM = new T.MeshBasicMaterial({ color: 0xcdf3ff });
  G.ringG = new T.RingGeometry(0.85, 1, 32); G.ringG.rotateX(-Math.PI / 2);
}
function mkRamp(rp, i) {
  const T = THREE, g = new T.Group(), ci = i % COLS.length;
  const w = new T.Mesh(G.wedge, G.mats[ci]); w.scale.set(rp.w, H, LEN); w.position.z = -LEN / 2; w.castShadow = true; g.add(w);
  const ar = new T.Mesh(G.arrowG, G.arrowM[ci]); ar.position.set(0, H + 1.2, -LEN / 2 - 0.3); g.add(ar);
  g.visible = false; root.add(g);
  return { id: rp.id, p: rp.p, x: rp.x, w: rp.w, g, ar };
}
function setRamps(list) {
  for (const o of ramps) root.remove(o.g);
  ramps = list.map(mkRamp);
  for (const o of ramps) {
    api.trackToWorld(o.p - LEN / 2, o.x, TP, TD);   // centro de la cuna: orientacion tangente a la curva en su punto medio
    o.g.position.set(TP.x, -0.08, TP.z); o.g.rotation.y = -Math.atan2(TD.x, -TD.z);
  }
}

/* ---------- salpicaduras y ondas ---------- */
function mkFx() {
  for (let i = 0; i < 70; i++) { const m = new THREE.Mesh(G.sph, G.dropM); m.visible = false; m.frustumCulled = false; scene.add(m); drops.push({ m, life: 0, vx: 0, vy: 0, vz: 0, s: 0.1 }); }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(G.ringG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false; m.frustumCulled = false; scene.add(m); rips.push({ m, life: 0, max: 0.7, r1: 4 });
  }
}
let di = 0, rj = 0;
function splash(x, z, big) {
  for (let i = 0; i < (big ? 22 : 8); i++) {
    const q = drops[di]; di = (di + 1) % drops.length; const a = Math.random() * 6.283, v = 1.5 + Math.random() * (big ? 4 : 2);
    q.m.position.set(x, 0.1, z); q.vx = Math.cos(a) * v; q.vz = Math.sin(a) * v; q.vy = 3 + Math.random() * (big ? 5 : 2.5); q.s = 0.07 + Math.random() * 0.1; q.life = 0.9;
    q.m.visible = true; q.m.scale.setScalar(q.s);
  }
  const r = rips[rj]; rj = (rj + 1) % rips.length;
  r.m.position.set(x, 0.1, z); r.life = r.max = 0.7; r.r1 = big ? 4.5 : 2; r.m.visible = true;
}
function updFx(dt) {
  for (let i = 0; i < drops.length; i++) {
    const q = drops[i]; if (q.life <= 0) continue;
    q.life -= dt; q.vy -= 14 * dt;
    q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
    if (q.life <= 0 || q.m.position.y < 0) { q.life = 0; q.m.visible = false; }
  }
  for (let i = 0; i < rips.length; i++) {
    const q = rips[i]; if (q.life <= 0) continue;
    q.life -= dt; if (q.life <= 0) { q.m.visible = false; continue; }
    const u = 1 - q.life / q.max; q.m.scale.setScalar(0.4 + (q.r1 - 0.4) * u); q.m.material.opacity = 0.75 * (1 - u);
  }
}

/* ---------- salto ---------- */
function rpOf(r) { return r._rp || (r._rp = { seen: 0, air: false, pp: -1, done: null, landAt: 0, pred: 0, vUntil: 0, y0: 0, peak: 2.4, lastH: 0 }); }
// altura/inclinacion de la cuna bajo el pato (por posicion: sirve para yo, bots y remotos interpolados)
let CH = 0, CP = 0;
function climb(r) {
  CH = 0; CP = 0;
  for (let i = 0; i < ramps.length; i++) {
    const o = ramps[i], d = o.p - r.p;
    if (d < -2 || d > LEN || Math.abs(r.x - o.x) >= o.w / 2) continue;
    if (d >= 0) { CH = Math.max(0, TOP * (1 - d / LEN)); CP = SLOPE * Math.min(1, (LEN - d) / 0.8); }
    else { const f = 1 + d / 2; CH = TOP * f; CP = SLOPE * f; }   // pasado el labio: se sostiene brevemente hasta que llegue el 'jump'
    return;
  }
}
function jumpStart(r, rp, near) {
  rp.air = true; rp.y0 = rp.lastH; rp.peak = PEAK_MIN + (PEAK_MAX - PEAK_MIN) * Math.min(1, Math.max(0, (r.vp - 5) / 10));
  if (near) snd.boing();
}
function jumpEnd(r, rp, near) {
  rp.air = false; rp.pred = 0; rp.landAt = performance.now();
  const q = r.duck.root.position; splash(q.x, q.z, true);
  if (near) snd.land();
}
function setScale(bob, sx, sy) { bob.scale.set(sx, sy, sx); }
function updJump(r, rp, n, me, camT, dt) {
  const bob = r.duck.bob;
  let au = r.airUntil || 0;
  if (rp.pred) {                                  // salto predicho localmente (online): se reconcilia con el 'jump' del servidor
    if (au > n && au > rp.pred) rp.vUntil += (au - rp.vUntil) * Math.min(1, dt * 10);
    else if (n > rp.pred + 350 && (r.airUntil || 0) <= rp.pred) { rp.pred = 0; rp.air = false; rp.cancelY = rp.lastH; bob.scale.set(1, 1, 1); }   // el servidor no lo concedio: se cancela
    if (rp.pred) au = rp.vUntil;
  }
  const near = r === me || (me && Math.abs(r.p - me.p) < 45);
  let y = 0;
  if (au > n) {
    if (rp.seen !== au && !rp.pred) rp.seen = au;
    if (!rp.air) jumpStart(r, rp, near);
    const u = Math.min(1, Math.max(0, 1 - (au - n) / JUMP_MS));
    y = rp.y0 * (1 - u) + rp.peak * 4 * u * (1 - u);
    bob.position.y += y;
    bob.rotation.x += SLOPE * (1 - Math.min(1, u * 2.5)) * (rp.y0 > 0.2 ? 1 : 0) - u * 6.2831853;   // voltereta completa
    let sy = 1;
    if (u < 0.12) sy = 1 - 0.3 * Math.sin(u / 0.12 * Math.PI * 0.5);
    else if (u < 0.55) sy = 1.28 - 0.28 * ((u - 0.12) / 0.43);
    else if (u > 0.9) sy = 1 + 0.25 * ((u - 0.9) / 0.1);
    setScale(bob, 1 / Math.sqrt(sy), sy);
    if (r === me) camT.v = Math.min(1, y / PEAK_MAX);
    rp.lastH = y;
  } else {
    if (rp.air) jumpEnd(r, rp, near);
    climb(r);
    if (rp.cancelY > 0.01) { rp.cancelY *= Math.exp(-dt * 10); bob.position.y += rp.cancelY; }
    bob.position.y += CH; bob.rotation.x += CP; rp.lastH = CH;
    y = CH;
    const e = (performance.now() - rp.landAt) / 1000;
    if (rp.landAt && e < 0.3) {
      const k = Math.exp(-e * 14) * Math.cos(e * 26), sy = 1 - 0.35 * k;
      setScale(bob, 1 / Math.sqrt(sy), sy);
    } else if (rp.landAt) { rp.landAt = 0; setScale(bob, 1, 1); }
  }
}

/* ---------- ciclo ---------- */
const camT = { v: 0 };
function genOffline(seed) {   // misma regla que el servidor: una rampa entre cada par de filas de cajas
  const L = api.consts.LENGTH, rowsN = Math.min(10, Math.max(3, Math.round((L - 100) / 130) + 1)), span = L - 100;
  const Rb = api.rng((seed ^ 0x5bd1e995) >>> 0), rows = [];
  for (let i = 0; i < rowsN; i++) {   // consume el RNG igual que powerups.js para obtener las mismas filas
    const edge = i === 0 || i === rowsN - 1, base = 60 + span * i / (rowsN - 1);
    rows.push(Math.round(Math.min(L - 40, Math.max(60, base + (edge ? 0 : (Rb() - 0.5) * 12))) * 10) / 10);
    Rb(); Rb(); Rb();
  }
  const R = api.rng((seed ^ 0x2545f491) >>> 0), out = [];
  for (let i = 0; i + 1 < rowsN && out.length < 8; i++) {
    const p = Math.round(((rows[i] + rows[i + 1]) / 2 + (R() - 0.5) * 16) * 10) / 10;
    const w = Math.round((4 + R() * 2) * 10) / 10, x = Math.round((R() - 0.5) * 12 * 10) / 10;
    if (rows.every(r => Math.abs(r - p) >= 20)) out.push({ id: out.length, p, x, w });
  }
  return out;
}
function update(dt, t) {
  if (!api) return;
  const n = api.now(), R = api.racers, me = api.me, off = !api.isOnline();
  camT.v = 0;
  const mp = me ? me.p : 0;
  for (let i = 0; i < ramps.length; i++) {
    const o = ramps[i], near = Math.abs(o.p - mp) < 140; o.g.visible = near;
    if (near) o.ar.position.y = H + 1.2 + Math.sin(t * 3 + i) * 0.25;
  }
  for (let i = 0; i < R.length; i++) {
    const r = R[i], rp = rpOf(r);
    if (racing && !r.finished && !r.dead && rp.pp >= 0 && (off || api.isSim(r)) && n >= (r.airUntil || 0) && !rp.pred && n >= (r.stunUntil || 0)) {
      for (let j = 0; j < ramps.length; j++) {
        const o = ramps[j];
        if (rp.pp < o.p && r.p >= o.p && Math.abs(r.x - o.x) < o.w / 2 && !(rp.done && rp.done[o.id])) {
          (rp.done || (rp.done = {}))[o.id] = true;
          if (off) r.airUntil = n + JUMP_MS; else { rp.pred = n; rp.vUntil = n + JUMP_MS; }   // online: solo visual; el servidor decide
          break;
        }
      }
    }
    rp.pp = r.p;
    updJump(r, rp, n, me, camT, dt);
  }
  if (api.fx) api.fx.camUp = camT.v * 1.8;
  updFx(dt);
}
function onNet(m) {
  if (!api || m.t !== 'jump') return;
  const R = api.racers;
  for (let i = 0; i < R.length; i++) if (R[i].slot === m.slot) { R[i].airUntil = m.until; const rp = rpOf(R[i]); (rp.done || (rp.done = {}))[m.ramp] = true; break; }
}
function resetRacers() {
  const R = api.racers;
  for (let i = 0; i < R.length; i++) { const r = R[i], rp = rpOf(r); r.airUntil = 0; rp.seen = 0; rp.air = false; rp.pp = -1; rp.done = null; rp.landAt = 0; rp.pred = 0; rp.lastH = 0; r.duck.bob.scale.set(1, 1, 1); }
}
function onRaceStart(st) {
  racing = true; JUMP_MS = ((api.consts && api.consts.JUMP_S) || 1) * 1000; resetRacers();
  setRamps(st && st.ramps ? st.ramps : genOffline((st && st.seed) | 0));
}
function onRaceEnd() { racing = false; if (!api) return; resetRacers(); if (api.fx) api.fx.camUp = 0; }
function init(a) {
  api = a; THREE = a.THREE; scene = a.scene; audio = a.audio;
  TP = new THREE.Vector3(); TD = new THREE.Vector3();
  api.fx = api.fx || { camUp: 0, camLock: false, shakeX: 0, shakeY: 0 };
  buildShared(); mkFx(); root = new THREE.Group(); scene.add(root);
}
window.DuckRamps = { init, update, onNet, onRaceStart, onRaceEnd, _ramps: () => ramps };
})();
