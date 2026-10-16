/* nuke.js - bomba atomica: 1 por carrera como maximo, sale al azar de una caja misteriosa y se activa sola.
   Cuenta atras de NUKE_DELAY_S para todos; al explotar, el que la recogio intercambia posicion con el 1er lugar
   y el mapa queda arrasado (obstaculos destruidos, cielo y luz apocalipticos) para todos hasta el fin de la carrera.
   Red: S->C nuke{from,id,at,serverNow}, nukeBoom{from,leader,a:{slot,p,x},b:{slot,p,x},serverNow}.
   Offline: powerups.js llama a DuckNuke.offlinePick(r) en cada caja; la N-esima es la bomba. Contrato de modulo. */
(function () {
'use strict';
let api = null, THREE = null, scene = null, audio = null;
let nuke = null, beep = -1, boomed = false, saved = null, cloud = null, cloudT = 0, ashT = 0;
let offN = 0, offPick = 0;
let elCount = null, elMsg = null, elTint = null, elFlash = null, elDizzy = null, elBlur = null, dizzyOn = false;
const SKY = 0x4a1d0f, FOG = 0x7a3415;

function bySlot(s) { const R = api.racers; for (let i = 0; i < R.length; i++) if (R[i].slot === s) return R[i]; return null; }
const delayMs = () => ((api.consts.NUKE_DELAY_S || 5) * 1000);
const tone = (f, d, g, o) => { if (audio && audio.ctx && !audio.muted && audio._tone) audio._tone(f, [[0, 1], [1, 1]], d, g, o || { type: 'square' }); };

function buildDom() {
  const css = document.createElement('style');
  css.textContent =
    '#nukeCount{position:absolute;left:0;right:0;top:12%;text-align:center;pointer-events:none;z-index:8;display:none;' +
    'font:900 clamp(26px,5vw,52px) Fredoka,"Trebuchet MS",sans-serif;color:#ffe14d;-webkit-text-stroke:3px #5a0000;text-shadow:0 6px 0 #5a0000}' +
    '#nukeCount b{display:block;font-size:2.4em;color:#ff3b1f;line-height:1}' +
    '#nukeMsg{position:absolute;left:0;right:0;top:30%;text-align:center;pointer-events:none;z-index:8;display:none;' +
    'font:900 clamp(22px,4vw,44px) Fredoka,"Trebuchet MS",sans-serif;color:#fff;-webkit-text-stroke:2px #5a0000;text-shadow:0 5px 0 #5a0000}' +
    '#nukeTint{position:fixed;inset:0;pointer-events:none;z-index:1;opacity:0;transition:opacity 2s;mix-blend-mode:multiply;' +
    'background:radial-gradient(ellipse at 50% 35%,#ffb070 0%,#d0582a 55%,#6a1a08 100%)}#nukeTint.on{opacity:.55}' +
    '#nukeFlash{position:fixed;inset:0;pointer-events:none;z-index:9;background:#fff;opacity:0}' +
    '#nukeFlash.go{animation:nkF 2.2s ease-out}@keyframes nkF{0%{opacity:1}25%{opacity:.95}100%{opacity:0}}' +
    '@keyframes nkP{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}#nukeCount.p b{animation:nkP .5s ease-in-out}' +
    '#nukeDizzy{position:absolute;left:0;right:0;top:20%;text-align:center;pointer-events:none;z-index:8;display:none;' +
    'font:900 clamp(26px,5vw,56px) Fredoka,"Trebuchet MS",sans-serif;color:#d9ff7a;-webkit-text-stroke:3px #2f4a00;text-shadow:0 5px 0 #2f4a00}' +
    '#nukeBlur{position:fixed;inset:0;pointer-events:none;z-index:2;display:none;backdrop-filter:blur(2.5px);-webkit-backdrop-filter:blur(2.5px)}';
  document.head.appendChild(css);
  const mk = (id, parent) => { const e = document.createElement('div'); e.id = id; parent.appendChild(e); return e; };
  elCount = mk('nukeCount', api.hudRoot); elMsg = mk('nukeMsg', api.hudRoot);
  elTint = mk('nukeTint', document.body); elFlash = mk('nukeFlash', document.body);
  elDizzy = mk('nukeDizzy', api.hudRoot); elBlur = mk('nukeBlur', document.body);
}

/* ---------- hongo atomico ---------- */
function buildCloud() {
  const T = THREE, g = new T.Group();
  const fire = new T.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95 });
  const smoke = new T.MeshLambertMaterial({ color: 0x8a6a5a, transparent: true, opacity: 0.9 });
  const sph = new T.SphereGeometry(1, 14, 10);
  const stem = new T.Mesh(new T.CylinderGeometry(0.9, 1.6, 1, 12), smoke); stem.position.y = 0.5; g.add(stem);
  const cap = new T.Group(); cap.position.y = 1;
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283, m = new T.Mesh(sph, i % 2 ? smoke : fire); m.position.set(Math.cos(a) * 1.4, Math.sin(i * 1.7) * 0.25, Math.sin(a) * 1.4); m.scale.setScalar(1.1); cap.add(m); }
  const core = new T.Mesh(sph, fire); core.scale.set(1.7, 1.1, 1.7); cap.add(core);
  g.add(cap); g.userData = { stem, cap, fire, smoke };
  const ring = new T.Mesh(new T.RingGeometry(0.85, 1, 48), new T.MeshBasicMaterial({ color: 0xffd08a, transparent: true, side: T.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; g.userData.ring = ring; scene.add(ring);
  g.visible = ring.visible = false; scene.add(g);
  return g;
}
function updCloud(dt) {
  if (!cloud || !cloud.visible) return;
  cloudT += dt;
  const u = Math.min(1, cloudT / 3), e = 1 - Math.pow(1 - u, 3), d = cloud.userData;
  const h = 4 + e * 26;
  d.stem.scale.set(1 + e * 1.5, h, 1 + e * 1.5); d.stem.position.y = h / 2; d.cap.position.y = h;
  d.cap.scale.setScalar(1 + e * 7); d.cap.rotation.y += dt * 0.3;
  d.fire.color.setHex(cloudT < 1.5 ? 0xffd04a : 0xff6a1a);
  const fade = cloudT > 9 ? Math.max(0, 1 - (cloudT - 9) / 4) : 1;
  d.fire.opacity = 0.95 * fade; d.smoke.opacity = 0.9 * fade;
  const rg = d.ring; rg.visible = cloudT < 2.5; rg.scale.setScalar(2 + cloudT * 70); rg.material.opacity = Math.max(0, 0.9 - cloudT / 2.5);
  if (fade <= 0) cloud.visible = false;
}

/* ---------- mapa arrasado ---------- */
function lights() { const out = []; scene.traverse(o => { if (o.isHemisphereLight || o.isDirectionalLight) out.push(o); }); return out; }
function transform() {
  if (saved) return;
  const L = lights(), sun = scene.getObjectByName('sunball');
  saved = { bg: scene.background.getHex(), fog: scene.fog.color.getHex(), L: L.map(l => [l, l.color.getHex(), l.groundColor ? l.groundColor.getHex() : null, l.intensity]), sun: sun ? [sun, sun.material.color.getHex(), sun.scale.x] : null };
  scene.background.setHex(SKY); scene.fog.color.setHex(FOG);   // el agua usa el mismo color de niebla (uFogC)
  for (const l of L) { l.color.setHex(l.isHemisphereLight ? 0xffa070 : 0xff8040); if (l.groundColor) l.groundColor.setHex(0x3a1a0a); l.intensity *= 0.85; }
  if (sun) { sun.material.color.setHex(0xff3010); sun.scale.setScalar(1.8); }
  if (api.nukeMap) api.nukeMap();   // remolinos, ramas, sapos y nenufares: volados
  elTint.classList.add('on');
}
function restore() {
  if (!saved) return;
  scene.background.setHex(saved.bg); scene.fog.color.setHex(saved.fog);
  for (const [l, c, gc, i] of saved.L) { l.color.setHex(c); if (gc !== null) l.groundColor.setHex(gc); l.intensity = i; }
  if (saved.sun) { saved.sun[0].material.color.setHex(saved.sun[1]); saved.sun[0].scale.setScalar(saved.sun[2]); }
  saved = null; elTint.classList.remove('on');
}

/* ---------- cuenta atras y explosion ---------- */
function start(m) {
  const r = bySlot(m.from);
  nuke = { from: m.from, at: m.at, who: r ? r.name : '¿?' };
  beep = -1; boomed = false;
  elCount.style.display = 'block';
  tone(220, 0.6, 0.35, { type: 'sawtooth' }); tone(330, 0.6, 0.3, { type: 'sawtooth', delay: 0.15 });
  api.shake(0.3);
}
function msg(t, ms) { elMsg.textContent = t; elMsg.style.display = 'block'; clearTimeout(msg.h); msg.h = setTimeout(() => { elMsg.style.display = 'none'; }, ms); }
function boom(m) {
  if (boomed) return; boomed = true;
  const from = bySlot(m.from), q = from ? from.duck.root.position : null;
  elCount.style.display = 'none'; nuke = null;
  elFlash.classList.remove('go'); void elFlash.offsetWidth; elFlash.classList.add('go');
  if (audio && audio.ctx && !audio.muted) { audio.boom && audio.boom(); setTimeout(() => audio.boom && audio.boom(), 180); audio._air && audio._air(2.5, 0.9, 400); }
  api.shake(2.5);
  if (q) {
    cloud.position.set(q.x, 0, q.z); cloud.userData.ring.position.set(q.x, 0.2, q.z); cloud.visible = true; cloudT = 0;
    if (api.burst) { api.burst(q.x, 2, q.z, 60, 14, 0xff8a1a, 1.4, 2, 4, 10); api.burst(q.x, 2, q.z, 40, 9, 0x5a4a40, 1.6, 3, 1, 6); }
  }
  // intercambio de puestos (el servidor ya movio las posiciones validadas)
  for (const s of [m.a, m.b]) {
    if (!s) continue;
    const r = bySlot(s.slot); if (!r) continue;
    r.p = r.tp = s.p; r.x = r.tpx = s.x; r.tx = s.x; r.tAge = performance.now();
  }
  for (const s of m.dazed || []) { const r = bySlot(s); if (r) r.dizzyUntil = m.dizzyUntil; }   // conmocionados y luego mareados
  const ld = m.leader != null ? bySlot(m.leader) : null;
  msg(ld && from ? '☢ ' + from.name + ' le robó el 1er lugar a ' + ld.name + '!' : '☢ ¡El mapa quedó arrasado!', 4500);
  transform();
}

// mareo: los patos se bambolean; si soy yo, la pantalla se tambalea, se nubla y la direccion se vuelve torpe (carrera.html)
function updDizzy(n, t) {
  const R = api.racers;
  for (let i = 0; i < R.length; i++) {
    const r = R[i]; if (!(n < (r.dizzyUntil || 0)) || r.dead) continue;
    const k = Math.min(1, (r.dizzyUntil - n) / 1500), b = r.duck.bob;
    b.rotation.z += Math.sin(t * 7 + r.slot) * 0.35 * k; b.rotation.x += Math.cos(t * 5 + r.slot) * 0.15 * k;
    if (api.emit && Math.random() < 0.25) { const q = r.duck.root.position, a = t * 6 + r.slot; api.emit(q.x + Math.cos(a) * 0.6, 1.5 * (r.giantScale || 1), q.z + Math.sin(a) * 0.6, 0, 0.2, 0, 0xfff36a, 0.1, 0.35, 0); }
  }
  const me = api.me, on = !!(me && n < (me.dizzyUntil || 0)), c = document.getElementById('c');
  if (on) {
    const k = Math.min(1, (me.dizzyUntil - n) / 1500);
    if (c) c.style.transform = 'rotate(' + (Math.sin(t * 1.7) * 3.5 * k).toFixed(2) + 'deg) scale(' + (1.06 + Math.sin(t * 2.3) * 0.03 * k).toFixed(3) + ')';
    api.fx.shakeX += Math.sin(t * 2.1) * 0.6 * k; api.fx.shakeY += Math.cos(t * 1.6) * 0.3 * k;
    elBlur.style.display = 'block'; elBlur.style.opacity = k.toFixed(2);
    elDizzy.style.display = 'block'; elDizzy.textContent = n < (me.stunUntil || 0) ? '¡CONMOCIONADO!' : '¡MAREADO!';
    elDizzy.style.transform = 'rotate(' + (Math.sin(t * 4) * 6).toFixed(1) + 'deg)';
  } else if (dizzyOn) { if (c) c.style.transform = ''; elBlur.style.display = 'none'; elDizzy.style.display = 'none'; }
  dizzyOn = on;
}
function update(dt, t) {
  if (!api) return;
  const n = api.now();
  updDizzy(n, t);
  if (nuke) {
    const left = Math.max(0, nuke.at - n), s = Math.ceil(left / 1000);
    if (s !== beep) {
      beep = s;
      elCount.innerHTML = '☢ BOMBA ATÓMICA de ' + nuke.who.replace(/[<>&]/g, '') + '<b>' + s + '</b>';
      elCount.classList.remove('p'); void elCount.offsetWidth; elCount.classList.add('p');
      if (s > 0) { tone(880, 0.25, 0.35); tone(660, 0.25, 0.3, { type: 'square', delay: 0.25 }); api.shake(0.15 + (5 - s) * 0.08); }
    }
    if (!api.isOnline() && left <= 0) offlineBoom();
  }
  updCloud(dt);
  if (saved && api.me && (ashT -= dt) <= 0 && api.emit) {   // ceniza y brasas cayendo alrededor del jugador
    ashT = 0.05; const q = api.me.duck.root.position;
    api.emit(q.x + (Math.random() - 0.5) * 30, 8 + Math.random() * 6, q.z - Math.random() * 30, (Math.random() - 0.5), -2, (Math.random() - 0.5), Math.random() < 0.3 ? 0xff7a1a : 0x6a5a55, 0.12, 3, 0.4);
  }
}

/* ---------- offline: mismas reglas que el servidor ---------- */
function offlinePick(r) {
  if (nuke || offPick < 0) return false;
  if (++offPick !== offN) return false;
  offPick = -1;
  start({ from: r.slot, at: api.now() + delayMs() });
  return true;
}
function offlineFire(r) {   // mod menu (tecla B) sin servidor
  if (nuke || !r || r.finished || r.dead) return false;
  start({ from: r.slot, at: api.now() + delayMs() });
  return true;
}
function offlineBoom() {
  const from = bySlot(nuke.from), R = api.racers, out = { from: nuke.from, leader: null };
  if (from && !from.finished && !from.dead) {
    let best = null;
    for (let i = 0; i < R.length; i++) { const r = R[i]; if (r === from || r.finished || r.dead || api.now() < (r.giantUntil || 0) || (r.isPlayer && window.DuckMod && DuckMod.god())) continue; if (!best || r.p > best.p) best = r; }
    if (best && best.p > from.p) { out.leader = best.slot; out.a = { slot: from.slot, p: best.p, x: best.x }; out.b = { slot: best.slot, p: from.p, x: from.x }; }
  }
  const n = api.now(), C = api.consts, st = (C.NUKE_STUN_S || 2.5) * 1000;
  out.dazed = []; out.dizzyUntil = n + st + (C.NUKE_DIZZY_S || 5) * 1000;
  for (let i = 0; i < R.length; i++) {   // mismas inmunidades que el servidor
    const r = R[i]; if (r === from || r.finished || r.dead || n < (r.airUntil || 0) || n < (r.giantUntil || 0) || n < (r.stunUntil || 0) || (r.isPlayer && window.DuckMod && DuckMod.god())) continue;
    r.stunUntil = n + st; out.dazed.push(r.slot);
  }
  boom(out);
}

function reset() {
  nuke = null; boomed = false; beep = -1; offPick = 0; offN = 3 + ((Math.random() * 10) | 0);
  if (api) for (const r of api.racers) r.dizzyUntil = 0;
  if (elDizzy) { const c = document.getElementById('c'); if (c) c.style.transform = ''; elBlur.style.display = 'none'; elDizzy.style.display = 'none'; dizzyOn = false; }
  if (elCount) { elCount.style.display = 'none'; elMsg.style.display = 'none'; }
  if (cloud) { cloud.visible = false; cloud.userData.ring.visible = false; }
  restore();
}

window.DuckNuke = {
  init(a) { api = a; THREE = a.THREE; scene = a.scene; audio = a.audio; buildDom(); cloud = buildCloud(); reset(); },
  update, offlinePick, offlineFire,
  onNet(m) { if (m.t === 'nuke') start(m); else if (m.t === 'nukeBoom') boom(m); },
  onRaceStart() { reset(); },
  onRaceEnd() { reset(); },
};
})();
