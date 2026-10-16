/* ovni.js - codigo secreto KIRK: teclas en pantalla, OVNI toon con haz y meteoritos, efectos alienigenas. Script clasico: window.DuckUfo.
   Contrato: init(api), onRaceStart(start), update(dt,t), onNet(msg), onRaceEnd(). Servidor: C->S kirk{}; S->C ufo{from(slot),serverNow,boostUntil,stunUntil} + stun por afectado. */
(function () {
'use strict';
const CODE = 'kirk', BOOST_MS = 1500, UFO_LIFE = 2.6;
let usesLeft = 3, cdUntil = 0, usedOnce = false, hudEl = null, hudTxt = null, hudRing = null, hudLast = '';
const stunMs = () => ((api.consts.UFO_STUN_S > 0 ? api.consts.UFO_STUN_S : 3) * 1000);
const cdMs = () => ((api.consts.UFO_COOLDOWN_S > 0 ? api.consts.UFO_COOLDOWN_S : 15) * 1000);
let api = null, THREE = null, scene = null, audio = null, camera = null;
let racing = false, idx = 0;
let keysEl = null, caps = [], tintEl = null, readyDom = false;
let G = null, ufos = [], minis = [], mets = [], sweepT = 0, fxT = 0;
let T1, T2, T3, UP, Q1;                 // temporales sin allocations por frame

/* ---------- DOM: teclas grandes, tinte y scanlines ---------- */
function buildDom() {
  if (readyDom) return; readyDom = true;
  const st = document.createElement('style');
  st.textContent =
    '#kirkKeys{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:flex;gap:clamp(8px,2vw,20px);pointer-events:none;z-index:3;opacity:0;transition:opacity .2s}' +
    '#kirkKeys.on{opacity:1}#kirkKeys.bad{animation:kkBad .35s ease-in-out}' +
    '.kkc{width:clamp(56px,11vw,120px);height:clamp(56px,11vw,120px);border-radius:22%;display:flex;align-items:center;justify-content:center;font:700 clamp(32px,7vw,72px) Fredoka,"Trebuchet MS",sans-serif;color:#7c8aa5;background:linear-gradient(#e8edf7,#c4cde0);border:4px solid #fff;box-shadow:0 10px 0 #7b88a6,0 14px 18px rgba(0,0,0,.25);transition:transform .1s,background .15s,color .15s;opacity:.85}' +
    '.kkc.lit{color:#fff;background:linear-gradient(#7dffb0,#16c26b);-webkit-text-stroke:3px #047857;paint-order:stroke fill;box-shadow:0 10px 0 #0b7a45,0 0 36px 8px rgba(80,255,150,.8);opacity:1;animation:kkPop .28s cubic-bezier(.3,1.8,.5,1)}' +
    '@keyframes kkPop{0%{transform:scale(.6) translateY(14px)}100%{transform:scale(1)}}' +
    '@keyframes kkBad{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 10px),-50%)}75%{transform:translate(calc(-50% + 10px),-50%)}}' +
    '#kirkHud{position:absolute;left:18px;top:96px;display:flex;align-items:center;gap:8px;pointer-events:none;z-index:2;font:700 clamp(13px,2vw,18px) Fredoka,"Trebuchet MS",sans-serif;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35);background:rgba(10,60,40,.45);border:3px solid #7dffb0;border-radius:999px;padding:3px 12px 3px 4px}' +
    '#kirkHud .khr{width:22px;height:22px;border-radius:50%;background:conic-gradient(#7dffb0 0deg,rgba(255,255,255,.25) 0deg);box-shadow:0 0 10px rgba(125,255,176,.7)}' +
    '#alienTint{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(60,255,140,.10),rgba(20,200,90,.38)),repeating-linear-gradient(0deg,rgba(0,40,20,.22) 0,rgba(0,40,20,.22) 2px,transparent 2px,transparent 5px);mix-blend-mode:screen}' +
    '#alienTint.on{animation:alPulse 1s ease-in-out infinite}@keyframes alPulse{0%,100%{opacity:.35}50%{opacity:.85}}';
  document.head.appendChild(st);
  keysEl = document.createElement('div'); keysEl.id = 'kirkKeys';
  for (let i = 0; i < 4; i++) { const c = document.createElement('div'); c.className = 'kkc'; c.textContent = CODE[i].toUpperCase(); keysEl.appendChild(c); caps.push(c); }
  api.hudRoot.appendChild(keysEl);
  tintEl = document.createElement('div'); tintEl.id = 'alienTint'; api.hudRoot.appendChild(tintEl);
  hudEl = document.createElement('div'); hudEl.id = 'kirkHud'; hudEl.style.display = 'none';
  hudRing = document.createElement('div'); hudRing.className = 'khr'; hudTxt = document.createElement('span');
  hudEl.append(hudRing, hudTxt); api.hudRoot.appendChild(hudEl);
}
function hudUpdate() {
  if (!hudEl) return;
  if (!usedOnce) { hudEl.style.display = 'none'; return; }
  const n = api.now(), left = cdUntil - n, cd = left > 0;
  const txt = 'KIRK \u00D7' + (usesLeft >= 999 ? '\u221E' : usesLeft) + (cd ? ' ' + Math.ceil(left / 1000) + 's' : '');
  const deg = cd ? Math.round(360 * (1 - left / cdMs()) / 6) * 6 : 360;
  const key = txt + deg; if (key === hudLast) return; hudLast = key;
  hudEl.style.display = 'flex'; hudTxt.textContent = txt;
  hudRing.style.background = 'conic-gradient(' + (cd ? '#7dffb0 ' + deg + 'deg,rgba(255,255,255,.25) ' + deg + 'deg' : '#7dffb0 360deg,#7dffb0 360deg') + ')';
  hudEl.style.opacity = usesLeft > 0 ? (cd ? '0.8' : '1') : '0.5';
}
function showKeys(n) {
  for (let i = 0; i < 4; i++) { const on = i < n, c = caps[i]; if (on && !c.classList.contains('lit')) { c.classList.remove('lit'); void c.offsetWidth; c.classList.add('lit'); } else if (!on) c.classList.remove('lit'); }
  keysEl.classList.toggle('on', n > 0);
}
function badKey() {
  keysEl.classList.remove('bad'); void keysEl.offsetWidth; keysEl.classList.add('bad');
  setTimeout(() => { if (idx === 0) showKeys(0); }, 260);
}

/* ---------- sonidos: chillido que sube, theremin alienigena ---------- */
const snd = {
  ok() { return audio && audio.ctx && !audio.muted; },
  key(i) { if (this.ok()) audio.squeak(0.8, 'bounce', 0.9 + i * 0.22); },
  done() { if (!this.ok()) return; [0, 1, 2, 3].forEach(i => audio._tone(900 * Math.pow(1.3, i), [[0, 0.8], [0.3, 1.4], [1, 1]], 0.16, 0.45, { delay: i * 0.06, type: 'sine' })); },
  theremin() {
    if (!this.ok()) return;
    const c = audio.ctx, now = c.currentTime, o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain(), d = c.createDelay(), fb = c.createGain();
    o.type = 'sine'; l.frequency.value = 6.5; lg.gain.value = 22; l.connect(lg); lg.connect(o.frequency);
    o.frequency.setValueAtTime(420, now); o.frequency.exponentialRampToValueAtTime(980, now + 0.9); o.frequency.exponentialRampToValueAtTime(560, now + 1.7); o.frequency.exponentialRampToValueAtTime(1250, now + 2.5);
    g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.28, now + 0.25); g.gain.setValueAtTime(0.28, now + 2.1); g.gain.exponentialRampToValueAtTime(0.0001, now + 2.7);
    d.delayTime.value = 0.22; fb.gain.value = 0.4; o.connect(g); g.connect(audio.out); g.connect(d); d.connect(fb); fb.connect(d); d.connect(audio.out);
    o.start(now); l.start(now); o.stop(now + 2.8); l.stop(now + 2.8);
  },
  zap() { if (this.ok()) audio._tone(1800, [[0, 1.6], [0.5, 0.5], [1, 0.9]], 0.3, 0.3, { type: 'sawtooth', fm: 60, fmd: 200 }); },
  whoosh() { if (this.ok()) { audio._air(0.4, 0.22, 900); audio._tone(1000, [[0, 1.6], [1, 0.4]], 0.4, 0.2, { type: 'sine', fm: 8, fmd: 120 }); } },
};

/* ---------- geometria compartida del OVNI (toon, original) ---------- */
function buildShared() {
  const T = THREE, B = (c, o) => new T.MeshBasicMaterial(Object.assign({ color: c }, o || {})), L = c => new T.MeshLambertMaterial({ color: c });
  G = {
    saucer: new T.SphereGeometry(1, 22, 12), dome: new T.SphereGeometry(1, 18, 12), sph: new T.SphereGeometry(1, 10, 8),
    beam: new T.CylinderGeometry(0.7, 3.4, 10, 20, 1, true), rock: new T.IcosahedronGeometry(0.6, 1),
    mSaucer: L(0xa78bfa), mBelly: L(0xf0abfc), mDome: B(0x9ff7ff, { transparent: true, opacity: 0.5 }), mAlien: L(0x6dff8a), mEye: B(0x111827),
    mBeam: B(0x6bff9a, { transparent: true, opacity: 0.14, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }),
    mRock: new T.MeshLambertMaterial({ color: 0xb4531a, emissive: 0xff4a00 }), mGlow: B(0xffa23a, { transparent: true, opacity: 0.35, depthWrite: false }),
    mLights: [0xffe14a, 0x6bff9a, 0xff6fb5, 0x7dd3fc].map(c => B(c)),
  };
}
function makeUfo(small) {
  const T = THREE, root = new T.Group(), lights = new T.Group();
  const body = new T.Mesh(G.saucer, G.mSaucer); body.scale.set(2.4, 0.55, 2.4); root.add(body);
  const belly = new T.Mesh(G.saucer, G.mBelly); belly.scale.set(1.5, 0.4, 1.5); belly.position.y = -0.28; root.add(belly);
  const dome = new T.Mesh(G.dome, G.mDome); dome.scale.set(1.1, 0.95, 1.1); dome.position.y = 0.4; root.add(dome);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832, l = new T.Mesh(G.sph, G.mLights[i % 4]); l.scale.setScalar(0.17); l.position.set(Math.cos(a) * 2.05, -0.02, Math.sin(a) * 2.05); lights.add(l); }
  root.add(lights);
  const u = { root, lights, beam: null, alien: null, r: null, t: 0, on: false, lz: false };
  if (!small) {
    const beam = new T.Mesh(G.beam, G.mBeam); beam.position.y = -3.2; beam.scale.y = 0.64; root.add(beam); u.beam = beam;
    const al = new T.Group(); const h = new T.Mesh(G.sph, G.mAlien); h.scale.set(0.5, 0.45, 0.5); al.add(h);
    for (const s of [-1, 1]) { const e = new T.Mesh(G.sph, G.mEye); e.scale.set(0.11, 0.16, 0.08); e.position.set(s * 0.2, 0.05, 0.4); al.add(e); }
    const an = new T.Mesh(G.sph, G.mAlien); an.scale.set(0.05, 0.3, 0.05); an.position.y = 0.55; al.add(an);
    const ab = new T.Mesh(G.sph, G.mLights[1]); ab.scale.setScalar(0.1); ab.position.y = 0.88; al.add(ab);
    al.position.y = 0.55; root.add(al); u.alien = al;
  } else root.scale.setScalar(0.32);
  if (!small) root.scale.setScalar(1.25);
  root.visible = false; scene.add(root); return u;
}
function bySlot(s) { const R = api.racers; for (let i = 0; i < R.length; i++) if (R[i].slot === s) return R[i]; return null; }
function pickUfo() { for (let i = 0; i < ufos.length; i++) if (!ufos[i].on) return ufos[i]; let o = ufos[0]; for (let i = 1; i < ufos.length; i++) if (ufos[i].t > o.t) o = ufos[i]; return o; }
function canvasFilter(v) { const c = document.getElementById('c'); if (c) c.style.filter = v; }

/* ---------- activacion (red u offline) ---------- */
function activate(m) {
  const r = bySlot(m.from); if (!r || !G) return;
  r.boostUntil = m.boostUntil || api.now() + BOOST_MS;
  const u = pickUfo(); u.r = r; u.t = 0; u.on = true; u.lz = false; u.root.visible = true;
  fxT = 3; if (tintEl) tintEl.classList.add('on');
  snd.theremin(); api.shake(0.35);
}
function complete() {
  snd.done(); setTimeout(() => { if (keysEl) keysEl.classList.remove('on'); }, 700);
  idx = 0; usedOnce = true; usesLeft--; cdUntil = api.now() + cdMs(); hudUpdate();
  if (api.isOnline()) { api.send({ t: 'kirk' }); return; }
  const n = api.now(), me = api.me, R = api.racers;
  activate({ from: me.slot, boostUntil: n + BOOST_MS });
  for (let i = 0; i < R.length; i++) { const r = R[i]; if (r !== me && !r.dead && n >= (r.airUntil || 0) && n >= (r.giantUntil || 0)) r.stunUntil = n + stunMs(); }
}
function onKey(e) {
  if (!racing || e.repeat || !api) return;
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = (e.key || '').toLowerCase(); if (k.length !== 1) return;
  cKey(k);
  if (usesLeft <= 0 || api.now() < cdUntil) { if (idx) { idx = 0; showKeys(0); } return; }
  if (k === CODE[idx]) { idx++; showKeys(idx); snd.key(idx - 1); if (idx === 4) complete(); }
  else if (idx > 0) { idx = k === CODE[0] ? 1 : 0; badKey(); if (idx === 1) { showKeys(1); snd.key(0); } }
}

/* ---------- frame ---------- */
let fxF = 0;
function update(dt, t) {
  if (!api || !G) return;
  const T = THREE;
  for (let i = 0; i < ufos.length; i++) {
    const u = ufos[i]; if (!u.on) continue;
    u.t += dt; const a = u.t, r = u.r, pp = r.duck.root.position;
    if (a >= UFO_LIFE) { u.on = false; u.root.visible = false; continue; }
    let y = 6.4;
    if (a < 0.6) { const k = 1 - a / 0.6; y += 26 * k * k * k; } else if (a > UFO_LIFE - 0.5) { const k = (a - (UFO_LIFE - 0.5)) / 0.5; y += 30 * k * k; }
    u.root.position.set(pp.x, y + Math.sin(t * 3) * 0.25, pp.z);
    u.root.rotation.z = Math.sin(t * 2.2) * 0.08; u.lights.rotation.y = t * 3.2;
    const bv = a > 0.4 && a < UFO_LIFE - 0.4; u.beam.visible = bv;
    if (bv) { const s = 1 + Math.sin(t * 14) * 0.07; u.beam.scale.set(s, 0.64, s); }
    u.alien.rotation.y = Math.sin(t * 2) * 0.6;
    if (a >= 0.5 && !u.lz) {
      u.lz = true; u.hit = false; snd.whoosh();
      const R = api.racers;
      for (let k = 0; k < R.length; k++) {
        const o = R[k]; if (o === r || o.dead || !o.duck.root.visible) continue;
        const m = freeMet(); if (!m) break;
        m.on = true; m.t = 0; m.r = o; m.u = u; m.root.visible = true; m.root.position.copy(u.root.position); m.sx = u.root.position.x; m.sy = u.root.position.y - 0.5; m.sz = u.root.position.z;
      }
    }
  }
  updateMets(dt, t);
  if (fxT > 0) {
    fxT -= dt; sweepT += dt; fxF -= dt;
    if (fxF <= 0) { fxF = 0.08; canvasFilter('hue-rotate(' + (Math.sin(t * 5) * 28 + 20).toFixed(0) + 'deg) saturate(' + (1.25 + Math.sin(t * 9) * 0.15).toFixed(2) + ')'); }
    camera.getWorldDirection(T1); T2.crossVectors(T1, UP).normalize();
    for (let i = 0; i < minis.length; i++) {
      const m = minis[i], s = (sweepT * 0.22 + i / minis.length) % 1;
      m.root.visible = true; m.lights.rotation.y = t * 4;
      m.root.position.set(camera.position.x + T1.x * (70 + i * 18) + T2.x * (s - 0.5) * 170, camera.position.y + 26 + i * 7 + Math.sin(t * 2 + i) * 2, camera.position.z + T1.z * (70 + i * 18) + T2.z * (s - 0.5) * 170);
    }
    if (fxT <= 0) stopFx();
  }
}
function freeMet() { for (let i = 0; i < mets.length; i++) if (!mets[i].on) return mets[i]; return null; }
function updateMets(dt, t) {
  for (let i = 0; i < mets.length; i++) {
    const m = mets[i]; if (!m.on) continue;
    m.t += dt / 0.4; const k = m.t > 1 ? 1 : m.t, e = k * k, o = m.r, tp = o.duck.root.position;
    m.root.position.set(m.sx + (tp.x - m.sx) * e, m.sy + (0.9 - m.sy) * e, m.sz + (tp.z - m.sz) * e);
    m.root.rotation.x += dt * 14; m.root.rotation.y += dt * 9;
    const q = m.root.position;
    api.emit(q.x, q.y, q.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, Math.random() < 0.5 ? 0xff9a1a : 0xffe14a, 2.6, 0.45, 0);
    api.emit(q.x, q.y, q.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0x666666, 3, 0.6, -1);
    if (k < 1) continue;
    m.on = false; m.root.visible = false;
    const n = api.now(), pu = o._pu, safe = n < (o.airUntil || 0) || n < (o.giantUntil || 0) || (pu && n < pu.immuneUntil);
    if (safe) { api.ring(tp.x, tp.z, 0x7dd3fc, 1.2); api.burst(tp.x, 1.5, tp.z, 10, 5, 0xdff6ff, 0.8, 0.6, 8, 4); if (window.DuckPowerups && window.DuckPowerups.ping) window.DuckPowerups.ping(o); else if (snd.ok()) audio.squeak(0.7, 'release', 1.6); continue; }
    api.burst(tp.x, 0.6, tp.z, 26, 8, 0xff7a1a, 0.9, 0.8, 9, 5); api.burst(tp.x, 0.6, tp.z, 14, 6, 0xffe14a, 0.8, 0.7, 9, 4); api.burst(tp.x, 0.5, tp.z, 14, 5, o.color, 0.8, 1.0, 12, 5);
    api.ring(tp.x, tp.z, 0xff7a1a, 1.4);
    if (snd.ok()) { audio.thud(1.1); audio.squeak(0.8, 'squeeze', 1.3); }
    if (m.u && !m.u.hit) { m.u.hit = true; api.shake(0.5); if (snd.ok()) audio.boom(); api.flashCharlie(); }
  }
}
function stopFx() {
  fxT = 0; if (tintEl) tintEl.classList.remove('on'); canvasFilter('');
  for (let i = 0; i < minis.length; i++) minis[i].root.visible = false;
}
function resetAll() {
  idx = 0; if (keysEl) { keysEl.classList.remove('on', 'bad'); showKeys(0); }
  for (let i = 0; i < ufos.length; i++) { ufos[i].on = false; ufos[i].root.visible = false; }
  for (let i = 0; i < mets.length; i++) { mets[i].on = false; mets[i].root.visible = false; }
  stopFx();
}

/* ---------- CANGRI: segundo codigo secreto (foto a pantalla completa para los demas) ---------- */
const CCODE = 'cangri', C_FLASH_MS = 1500, C_STUN_MS = 1000;
let cIdx = 0, cUses = 2, cCdUntil = 0, cUsedOnce = false, cKeysEl = null, cCaps = [], cHud = null, cHudTxt = null, cHudRing = null, cHudLast = '';
let cSfx = null, cSfxOk = true;
let cFlash = null, cFlashT = 0, cSprite = null, cSpriteT = 0, cSpriteOwner = null, cImg = null;
const cCdMs = () => ((api.consts.CANGRI_COOLDOWN_S > 0 ? api.consts.CANGRI_COOLDOWN_S : 15) * 1000);
function buildCangriDom() {
  const st = document.createElement('style');
  st.textContent =
    '#cangriKeys{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:flex;gap:clamp(6px,1.4vw,14px);pointer-events:none;z-index:3;opacity:0;transition:opacity .2s}' +
    '#cangriKeys.on{opacity:1}#cangriKeys.bad{animation:kkBad .35s ease-in-out}' +
    '#cangriKeys .kkc{width:clamp(44px,8.5vw,92px);height:clamp(44px,8.5vw,92px);font-size:clamp(26px,5.4vw,56px)}' +
    '#cangriKeys .kkc.lit{background:linear-gradient(#ffe680,#f2a900);-webkit-text-stroke:3px #8a5200;box-shadow:0 10px 0 #a86a00,0 0 36px 8px rgba(255,200,60,.85)}' +
    '#cangriHud{position:absolute;left:18px;top:140px;display:flex;align-items:center;gap:8px;pointer-events:none;z-index:2;font:700 clamp(13px,2vw,18px) Fredoka,"Trebuchet MS",sans-serif;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35);background:rgba(80,50,0,.5);border:3px solid #ffd45a;border-radius:999px;padding:3px 12px 3px 4px}' +
    '#cangriHud .khr{width:22px;height:22px;border-radius:50%;box-shadow:0 0 10px rgba(255,212,90,.7)}' +
    '#cangriFlash{position:absolute;left:50%;top:50%;width:min(80vmin,92vw);height:auto;max-height:90vh;object-fit:contain;border-radius:24px;pointer-events:none;z-index:12;opacity:0;display:none;transform:translate(-50%,-50%) scale(.6);box-shadow:0 0 60px rgba(255,200,60,.9)}' +
    '#cangriFlash.go{display:block;animation:cgFlash 1.5s linear forwards}' +
    '@keyframes cgFlash{0%{opacity:0;transform:translate(-50%,-50%) scale(.5) rotate(-6deg)}8%{opacity:1;transform:translate(-50%,-50%) scale(1.08) rotate(2deg)}14%{transform:translate(-50%,-50%) scale(1) rotate(0)}78%{opacity:1;transform:translate(-50%,-50%) scale(1.02)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.06)}}';
  document.head.appendChild(st);
  cKeysEl = document.createElement('div'); cKeysEl.id = 'cangriKeys';
  for (let i = 0; i < 6; i++) { const c = document.createElement('div'); c.className = 'kkc'; c.textContent = CCODE[i].toUpperCase(); cKeysEl.appendChild(c); cCaps.push(c); }
  api.hudRoot.appendChild(cKeysEl);
  cHud = document.createElement('div'); cHud.id = 'cangriHud'; cHud.style.display = 'none';
  cHudRing = document.createElement('div'); cHudRing.className = 'khr'; cHudTxt = document.createElement('span'); cHud.append(cHudRing, cHudTxt); api.hudRoot.appendChild(cHud);
  try { cSfx = new Audio('sfx/cangri.mp3'); cSfx.preload = 'auto'; cSfx.volume = 0.6; cSfx.addEventListener('error', () => { cSfxOk = false; }); } catch (e) { cSfx = null; cSfxOk = false; }
  cImg = new Image(); cImg.src = 'cangri.webp';           // precarga
  cFlash = document.createElement('img'); cFlash.id = 'cangriFlash'; cFlash.alt = ''; cFlash.src = 'cangri.webp'; api.hudRoot.appendChild(cFlash);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; const c = cv.getContext('2d');
  c.font = '900 104px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 16; c.lineJoin = 'round';
  c.strokeStyle = '#7a4a00'; c.strokeText('¡CANGRI!', 256, 84); c.fillStyle = '#ffd45a'; c.fillText('¡CANGRI!', 256, 84);
  cSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false, opacity: 0 }));
  cSprite.visible = false; cSprite.renderOrder = 22; cSprite.scale.set(4, 1.25, 1); scene.add(cSprite);
}
function cShowKeys(n) {
  for (let i = 0; i < 6; i++) { const on = i < n, c = cCaps[i]; if (on && !c.classList.contains('lit')) { c.classList.remove('lit'); void c.offsetWidth; c.classList.add('lit'); } else if (!on) c.classList.remove('lit'); }
  cKeysEl.classList.toggle('on', n > 0);
}
function cHudUpdate() {
  if (!cHud) return;
  if (!cUsedOnce) { cHud.style.display = 'none'; return; }
  const left = cCdUntil - api.now(), cd = left > 0;
  const txt = 'CANGRI ×' + cUses + (cd ? ' ' + Math.ceil(left / 1000) + 's' : '');
  const deg = cd ? Math.round(360 * (1 - left / cCdMs()) / 6) * 6 : 360;
  const key = txt + deg; if (key === cHudLast) return; cHudLast = key;
  cHud.style.display = 'flex'; cHudTxt.textContent = txt;
  cHudRing.style.background = 'conic-gradient(#ffd45a ' + deg + 'deg,rgba(255,255,255,.25) ' + deg + 'deg)';
  cHud.style.opacity = cUses > 0 ? (cd ? '0.8' : '1') : '0.5';
}
function cPlay() {   // audio de CANGRI para todos (autor incluido); si falla, queda el sintetizado de respaldo
  if (audio && audio.muted) return true;
  if (!cSfx || !cSfxOk) return false;
  try { cSfx.currentTime = 0; const pr = cSfx.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { return false; }
  return true;
}
function cApply(m) {
  const played = cPlay();   // llega cangri{from,flashMs}: el autor ve un cartel sobre su pato; los demas, foto y temblor
  const me = api.me, au = bySlot(m.from);
  if (me && m.from === me.slot) { cSpriteOwner = au; cSpriteT = 1.3; if (!played && snd.ok()) audio.squeak(1, 'squeeze', 1.6); return; }
  const ms = m.flashMs > 0 ? m.flashMs : C_FLASH_MS;
  cFlash.style.animationDuration = (ms / 1000) + 's'; cFlash.classList.remove('go'); void cFlash.offsetWidth; cFlash.classList.add('go'); cFlashT = ms / 1000;
  api.shake(1.4); if (!played && snd.ok()) { audio.boom(); audio.squeak(1.2, 'squeeze', 1.9); }
  cSpriteOwner = au; cSpriteT = 1.3;
}
function cComplete() {
  snd.done(); setTimeout(() => { if (cKeysEl) cKeysEl.classList.remove('on'); }, 700);
  cIdx = 0; cUsedOnce = true; cUses--; cCdUntil = api.now() + cCdMs(); cHudUpdate();
  if (api.isOnline()) { api.send({ t: 'cangri' }); return; }
  const n = api.now(), me = api.me, R = api.racers;
  cApply({ from: me.slot });
  for (let i = 0; i < R.length; i++) { const r = R[i]; if (r !== me && !r.dead && n >= (r.airUntil || 0) && n >= (r.giantUntil || 0)) r.stunUntil = n + C_STUN_MS; }
}
function cKey(k) {
  if (cUses <= 0 || api.now() < cCdUntil) { if (cIdx) { cIdx = 0; cShowKeys(0); } return; }
  if (k === CCODE[cIdx]) { cIdx++; cShowKeys(cIdx); snd.key(cIdx - 1); if (cIdx === 6) cComplete(); }
  else if (cIdx > 0) {
    cIdx = k === CCODE[0] ? 1 : 0; cKeysEl.classList.remove('bad'); void cKeysEl.offsetWidth; cKeysEl.classList.add('bad');
    setTimeout(() => { if (cIdx === 0) cShowKeys(0); }, 260); if (cIdx === 1) { cShowKeys(1); snd.key(0); }
  }
}
function cUpdate(dt) {
  if (cFlashT > 0) cFlashT -= dt;
  if (cSpriteT > 0 && cSpriteOwner) {
    cSpriteT -= dt;
    if (cSpriteT <= 0) cSprite.visible = false;
    else { const u = 1 - cSpriteT / 1.3, q = cSpriteOwner.duck.root.position, k = 1 + Math.sin(Math.min(1, u * 4) * Math.PI) * 0.3;
      cSprite.visible = true; cSprite.position.set(q.x, 2.4 + u * 1.2, q.z); cSprite.scale.set(4 * k, 1.25 * k, 1); cSprite.material.opacity = u > 0.7 ? (1 - u) / 0.3 : 1; }
  }
  cHudUpdate();
}

window.DuckUfo = {
  init(a) {
    api = a; THREE = a.THREE; scene = a.scene; audio = a.audio; camera = a.camera;
    T1 = new THREE.Vector3(); T2 = new THREE.Vector3(); T3 = new THREE.Vector3(); UP = new THREE.Vector3(0, 1, 0);
    buildDom(); buildCangriDom(); buildShared();
    for (let i = 0; i < 3; i++) ufos.push(makeUfo(false));
    for (let i = 0; i < 3; i++) minis.push(makeUfo(true));
    for (let i = 0; i < 8; i++) {
      const root = new THREE.Group(); root.add(new THREE.Mesh(G.rock, G.mRock)); const gl = new THREE.Mesh(G.sph, G.mGlow); gl.scale.setScalar(1.0); root.add(gl);
      root.visible = false; scene.add(root); mets.push({ root, on: false, t: 0, r: null, u: null, sx: 0, sy: 0, sz: 0 });
    }
    window.addEventListener('keydown', onKey);
  },
  onRaceStart() { racing = true; usesLeft = (api.consts.UFO_PER_RACE | 0) || 3; cdUntil = 0; usedOnce = false; hudLast = ''; cIdx = 0; cUses = (api.consts.CANGRI_PER_RACE | 0) || 2; cCdUntil = 0; cUsedOnce = false; cHudLast = ''; if (cKeysEl) cShowKeys(0); resetAll(); hudUpdate(); },
  update(dt, t) { update(dt, t); if (racing) { hudUpdate(); cUpdate(dt); } },
  onNet(m) {
    if (!m) return;
    if (m.t === 'cangri') cApply(m);
    else if (m.t === 'cangriState' || m.t === 'cangriNo') { if (typeof m.usesLeft === 'number') cUses = m.usesLeft; if (typeof m.cooldownUntil === 'number') cCdUntil = m.cooldownUntil; cUsedOnce = cUsedOnce || m.t === 'cangriNo' || cUses < 2; }
    else if (m.t === 'ufo') { activate(m); const me = api.me; if (me && m.from === me.slot) { if (typeof m.usesLeft === 'number') usesLeft = m.usesLeft; if (typeof m.cooldownUntil === 'number') cdUntil = m.cooldownUntil; } }
    else if (m.t === 'kirkNo' || m.t === 'kirkState') { if (typeof m.usesLeft === 'number') usesLeft = m.usesLeft; if (typeof m.cooldownUntil === 'number') cdUntil = m.cooldownUntil; }
  },
  onRaceEnd() { racing = false; resetAll(); if (hudEl) hudEl.style.display = 'none'; cIdx = 0; if (cKeysEl) { cShowKeys(0); cHud.style.display = 'none'; cFlash.classList.remove('go'); cSprite.visible = false; } },
};
})();
