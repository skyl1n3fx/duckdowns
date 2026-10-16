'use strict';
// Servidor multijugador de la carrera de patos. Contrato: ../PROTOCOLO.md
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ROOT = path.resolve(__dirname, '..');
const MAX_PLAYERS = 8;
const MAX_MSG = 4096;
const RATE = 40, BURST = 60;          // msgs/s y rafaga
const COUNTDOWN_MS = 4000;
const SOLO_COUNTDOWN_MS = 1500;       // un solo jugador: cuenta corta
const RESULTS_MS = 15000;
const FINISH_GRACE_MS = 60000;
// paleta fija (enteros 0xRRGGBB); el cliente envia uno de estos valores
// ---- constantes compartidas con el cliente (CFG de carrera.html); unica fuente en el servidor ----
const C = {
  LENGTH: Math.min(5000, Math.max(100, Number(process.env.DUCK_LENGTH) || 1200)),   // largo del rio; meta en p = LENGTH (DUCK_LENGTH solo para tests)
  HALF_W: 11,             // semiancho navegable
  MAX_SPEED: 15,          // tope de velocidad de un jugador (u/s)
  BOT_MAX: 14.2,          // crucero maximo de bots
  BOT_RUBBER: 0.12,       // bonus maximo por rubber-band
  BOT_AVG: 12.5,
  GIANT_S: 8, GIANT_SCALE: 3, GIANT_BUMP_R: 4, GIANT_BUMP_STUN_S: 2, UFO_BOOST: 1.4, UFO_BOOST_S: 1.5, UFO_STUN_S: 1, UFO_PER_RACE: 1, JUMP_S: 1, JUMP_BOOST: 1.25, SHOUT_N: 3, STUN_S: 2, IMMUNE_S: 1, BOX_RESPAWN_S: 6,          // velocidad media (bots simulados por el servidor)
};
C.BOT_CAP = C.BOT_MAX * (1 + C.BOT_RUBBER) + 0.6;   // tope de bots incl. rubber-band
const TOL_FINISH = 2;               // tolerancia en p para dar la meta
const STEP_MARGIN = 1.5;            // margen del paso entre mensajes (jitter de red)
const ENV_MARGIN = 1.05, ENV_SLACK = 3; // envolvente absoluta: p <= MAX*1.1*t + 3
const BACK_RATE = 10;               // retroceso maximo (u/s)
const LAT_RATE = 30;                // desplazamiento lateral maximo (u/s)
const MAX_VX = 30;
const HOST_STRIKES = 40;            // recortes de bots antes de quitar el rol de host
const BOT_STALE_MS = 600;           // sin datos del host: el servidor avanza el bot
// ---- power-ups ----
const BOX_RESPAWN_MS = 6000, BOX_DP = 2.5, BOX_DX = 2;
const STUN_MS = 2000, IMMUNE_MS = 1000, STUN_DRIFT = 0.5;   // deriva maxima aturdido (u/s)
const ACT_GAP_MS = 150;                                     // pickup/fire: 1 cada 150 ms por pato
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function genBoxes(seed) {   // 3 cajas por fila, ~9 filas repartidas en [60, LENGTH-40]; solo el servidor las genera
  const R = mulberry32(seed ^ 0x5bd1e995), out = [];
  const rows = clamp(Math.round((C.LENGTH - 100) / 130) + 1, 3, 10), span = C.LENGTH - 100;
  for (let i = 0; i < rows; i++) {
    const base = 60 + (span * i) / (rows - 1), edge = i === 0 || i === rows - 1;
    const p = Math.round(clamp(base + (edge ? 0 : (R() - 0.5) * 12), 60, C.LENGTH - 40) * 10) / 10;
    for (const x0 of [-6, 0, 6]) out.push({ id: out.length, p, x: Math.round((x0 + (R() - 0.5) * 3) * 10) / 10 });
  }
  return out;
}
function genRamps(seed, boxes) {   // una rampa entre cada par de filas de cajas (>=20 u de cualquier caja)
  const R = mulberry32(seed ^ 0x2545f491), rows = [...new Set(boxes.map(b => b.p))].sort((a, b) => a - b), out = [];
  for (let i = 0; i + 1 < rows.length && out.length < 8; i++) {
    const p = Math.round(((rows[i] + rows[i + 1]) / 2 + (R() - 0.5) * 16) * 10) / 10;
    const w = Math.round((4 + R() * 2) * 10) / 10, x = Math.round((R() - 0.5) * 12 * 10) / 10;
    if (rows.every(r => Math.abs(r - p) >= 20)) out.push({ id: out.length, p, x, w });
  }
  return out;
}
const ITEMS = ['bazooka', 'megafono', 'gigante'];
const BUMP_GAP_MS = 2500;           // un mismo objetivo solo puede ser embestido 1 vez cada 2.5 s
// kind de cada caja: lo decide el servidor al generarla y en cada reaparicion (DUCK_ITEM solo para tests)
const randomKind = () => (ITEMS.includes(process.env.DUCK_ITEM) ? process.env.DUCK_ITEM : ITEMS[crypto.randomInt(ITEMS.length)]);
const COLORS = [0xffd21f, 0xff5fa8, 0x3aa0ff, 0x39d96b, 0xa96bff, 0xff8a2b, 0x22d3c5, 0xff4d4d, 0xffffff, 0x8b5a2b];
function freeColor(want, selfId) {
  const used = new Set([...players.values()].filter(q => q.id !== selfId && q.color !== undefined).map(q => q.color));
  if (COLORS.includes(want) && !used.has(want)) return want;
  return COLORS.find(c => !used.has(c));
}

// ---------- estaticos ----------
const STATIC = {
  '/carrera.html': 'text/html; charset=utf-8',
  '/index.html': 'text/html; charset=utf-8',
  '/charlie.webp': 'image/webp',
  '/musica.mp3': 'audio/mpeg',
  '/powerups.js': 'text/javascript; charset=utf-8',
  '/rampas.js': 'text/javascript; charset=utf-8',
  '/ovni.js': 'text/javascript; charset=utf-8',
};
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = ''; }
  if (p === '/') p = '/carrera.html';
  const type = STATIC[p];                       // lista blanca: sin traversal posible
  const file = type && path.join(ROOT, path.basename(p));
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(type ? 405 : 404, { 'content-type': 'text/plain' });
    return res.end('no');
  }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('no'); }
    const hdr = { 'content-type': type, 'content-length': st.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };
    res.writeHead(200, hdr);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

// ---------- utilidades ----------
const now = () => Date.now();
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function cleanNick(raw) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff<>&"'`]/g, '');
  s = s.replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return s;
}

function shareUrls() {
  const out = [];
  const pub = (process.env.PUBLIC_URL || '').trim();
  if (/^https?:\/\/[^\s<>"'`]{1,200}$/i.test(pub)) out.push(pub);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(`http://${a.address}:${PORT}/carrera.html`);
    }
  }
  out.push(`http://localhost:${PORT}/carrera.html`);
  return [...new Set(out)];
}

// ---------- estado ----------
let nextId = 1;
const players = new Map();   // id -> {ws,id,nick,ready,tokens,last,inRace,...}
let phase = 'lobby';         // lobby | countdown | race | results
let race = null;             // {seed,startAt,slots,finishes:[],bots:Map,timer}
let resetTimer = null;
let hostId = null;
let hostClips = 0;          // recortes acumulados del host actual en la carrera
const hostBanned = new Set(); // ids a los que se les quito el rol de host

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
function uniqueNick(base, selfId) {
  let n = cleanNick(base) || 'Pato';
  const taken = new Set([...players.values()].filter(p => p.id !== selfId).map(p => p.nick.toLowerCase()));
  if (!cleanNick(base)) { let k = 1; while (taken.has(`pato ${k}`)) k++; return `Pato ${k}`; }
  let cand = n, k = 2;
  while (taken.has(cand.toLowerCase())) { const suf = ` ${k++}`; cand = n.slice(0, 16 - suf.length) + suf; }
  return cand;
}
function pickHost() {
  if (hostId !== null && players.has(hostId)) return;
  const ids = [...players.keys()];
  hostId = ids.find(i => !hostBanned.has(i)) ?? ids[0] ?? null;
}
function lobbyMsg() {
  return { t: 'lobby', phase, hostId, shareUrls: shareUrls(), players: [...players.values()].map(p => ({ id: p.id, nick: p.nick, ready: p.ready, host: p.id === hostId, color: p.color })) };
}
const sendLobby = () => broadcast(lobbyMsg());

// ---------- validacion de movimiento ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// st: {p,x,vp,vx,tp(ms ultimo),init}; raw: valores del cliente (ya numericos). Devuelve true si hubo recorte.
function applyMove(st, raw, cap, startAt, tNow) {
  const dt = clamp((tNow - st.tp) / 1000, 0.005, 5);
  const el = Math.max(0, (tNow - startAt) / 1000);
  const stunned = tNow < (st.stunUntil || 0);
  // impulsos legitimos: salto de rampa (x1.25) o OVNI/KIRK (x1.4); se amplian tope y envolvente (envBonus)
  cap *= Math.max(tNow < (st.airUntil || 0) ? C.JUMP_BOOST : 1, tNow < (st.ufoUntil || 0) ? C.UFO_BOOST : 1);
  const maxP = Math.min(cap * ENV_MARGIN * Math.max(0, el - (st.stunLost || 0) + (st.envBonus || 0)) + ENV_SLACK, C.LENGTH + 5);
  let hi = Math.min(st.p + cap * STEP_MARGIN * dt + 1, maxP);
  if (stunned) hi = Math.min(hi, st.p + STUN_DRIFT * dt);   // aturdido: sin avance (solo deriva minima)
  const lo = Math.max(st.p - BACK_RATE * dt - 1, -1);
  let clipped = raw.p > hi + 1e-9 || raw.p < lo - 1e-9;
  const p = clamp(raw.p, lo, hi);
  const xr = C.HALF_W + 0.5;
  let x = clamp(raw.x, -xr, xr);
  if (st.init) x = clamp(x, st.x - LAT_RATE * dt - 0.5, st.x + LAT_RATE * dt + 0.5);
  clipped = clipped || Math.abs(x - raw.x) > 0.01;
  const vcap = stunned ? 1 : cap * 1.1;
  const vp = clamp(raw.vp, -vcap, vcap), vx = clamp(raw.vx, -MAX_VX, MAX_VX);
  clipped = clipped || vp !== raw.vp || vx !== raw.vx;
  st.p = p; st.x = x; st.vp = vp; st.vx = vx; st.tp = tNow; st.init = true;
  return clipped;
}
// El servidor decide el salto: p cruza la rampa y |x-ramp.x|<w/2 con la posicion saneada
function checkRamps(st, prevP, slot, tNow) {
  if (!race || tNow < (st.airUntil || 0) || tNow < (st.stunUntil || 0)) return;
  for (const r of race.ramps) {
    if (prevP < r.p && st.p >= r.p && Math.abs(st.x - r.x) < r.w / 2 && !(st.rampsDone && st.rampsDone.has(r.id))) {
      (st.rampsDone = st.rampsDone || new Set()).add(r.id);
      st.airUntil = tNow + C.JUMP_S * 1000; st.envBonus = (st.envBonus || 0) + (C.JUMP_BOOST - 1) * C.JUMP_S;
      broadcast({ t: 'jump', slot, id: race.slots[slot].id, ramp: r.id, until: st.airUntil, serverNow: tNow });
      return;
    }
  }
}
function newMove(startAt) { return { p: 0, x: 0, vp: 0, vx: 0, tp: startAt, init: false }; }

function sanitizeData(v, depth = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? clamp(v, -1e5, 1e5) : 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.replace(/[\u0000-\u001f<>&"'`]/g, '').slice(0, 32);
  if (depth >= 2) return undefined;
  if (Array.isArray(v)) return v.slice(0, 8).map(x => sanitizeData(x, depth + 1)).filter(x => x !== undefined);
  if (v && typeof v === 'object') {
    const o = {}; let n = 0;
    for (const k of Object.keys(v)) {
      if (n >= 8) break;
      if (!/^[a-zA-Z0-9_]{1,16}$/.test(k) || k === '__proto__') continue;
      const s = sanitizeData(v[k], depth + 1); if (s !== undefined) { o[k] = s; n++; }
    }
    return o;
  }
  return undefined;
}

// ---------- carrera ----------
function maybeStart() {
  if (phase !== 'lobby' || players.size === 0) return;
  if (![...players.values()].every(p => p.ready)) return;
  const list = [...players.values()];
  const lanes = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = lanes.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
  const slots = [];
  list.forEach((p, i) => { slots[lanes[i]] = { slot: lanes[i], id: p.id, nick: p.nick, kind: 'player', color: p.color }; p.slot = lanes[i]; p.inRace = true; p.finished = false; p.mv = null; p.wantFinish = false; p.item = null; p.ufoUsed = 0; });
  const spare = COLORS.filter(c => !list.some(q => q.color === c));
  for (let i = list.length; i < MAX_PLAYERS; i++) slots[lanes[i]] = { slot: lanes[i], id: null, nick: `Bot ${lanes[i] + 1}`, kind: 'bot', color: spare[i - list.length] };
  const t0 = now();
  const cd = list.length === 1 ? SOLO_COUNTDOWN_MS : COUNTDOWN_MS;
  race = { seed: crypto.randomInt(1, 2 ** 31), startAt: t0 + cd, slots, finishes: [], done: new Set(), bots: new Map(), timer: null, graceTimer: null, boxes: genBoxes(0), botItems: new Map(), lastAct: new Map(), timers: new Set() };
  race.boxes = genBoxes(race.seed).map(b => ({ ...b, active: true, kind: randomKind() }));
  race.bumpAt = new Map();
  race.ramps = genRamps(race.seed, race.boxes);
  for (const p of list) p.mv = newMove(race.startAt);
  for (const s of slots) if (s.kind === 'bot') race.bots.set(s.slot, newMove(race.startAt));
  for (const p of list) { p.clips = 0; }
  hostClips = 0;
  phase = 'countdown';
  broadcast({ t: 'start', seed: race.seed, startAt: race.startAt, serverNow: t0, slots, hostId, boxes: race.boxes.map(({ id, p, x, kind }) => ({ id, p, x, kind })), ramps: race.ramps });
  broadcast(lobbyMsg());
  setTimeout(() => { if (phase === 'countdown') phase = 'race'; }, cd);
}

function slotInfo(slot) { return race.slots[slot]; }

function recordFinish(slot) {
  if (!race || race.done.has(slot) || phase !== 'race') return;
  const time = Math.round((now() - race.startAt)) / 1000;
  race.done.add(slot);
  const place = race.done.size;
  const s = slotInfo(slot);
  race.finishes.push({ slot, id: s.id, kind: s.kind, nick: s.nick, place, time });
  broadcast({ t: 'finished', id: s.id, slot, place, time });
  if (s.kind === 'player' && !race.graceTimer) race.graceTimer = setTimeout(endRace, FINISH_GRACE_MS);
  checkEnd();
}
// Meta valida: p validado >= LENGTH-TOL y tiempo de servidor >= LENGTH/MAX
function tryFinishPlayer(p) {
  if (!race || phase !== 'race' || !p.inRace || p.dnf || !p.wantFinish || race.done.has(p.slot)) return;
  const el = (now() - race.startAt) / 1000;
  if (p.mv.p >= C.LENGTH - TOL_FINISH && el >= C.LENGTH / C.MAX_SPEED) recordFinish(p.slot);
}
function tryFinishBot(slot) {
  const b = race.bots.get(slot);
  if (!b || race.done.has(slot)) return;
  const el = (now() - race.startAt) / 1000;
  if (b.p >= C.LENGTH - TOL_FINISH && el >= C.LENGTH / C.BOT_CAP) recordFinish(slot);
}
function slotP(slot) {
  const s = race.slots[slot];
  if (s.kind === 'bot') return (race.bots.get(slot) || {}).p || 0;
  const q = players.get(s.id);
  return q && q.mv ? q.mv.p : 0;
}
function checkEnd() {
  if (!race) return;
  const alive = [...players.values()].filter(p => p.inRace && !p.dnf);
  if (alive.every(p => race.done.has(p.slot))) endRace();
}
function endRace() {
  if (!race || phase === 'results') return;
  clearTimeout(race.graceTimer);
  phase = 'results';
  const order = race.finishes.slice();
  const rest = race.slots.filter(s => !race.done.has(s.slot))
    .sort((a, b) => slotP(b.slot) - slotP(a.slot));
  for (const s of rest) order.push({ slot: s.slot, id: s.id, kind: s.kind, nick: s.nick, place: order.length + 1, time: null });
  order.forEach((o, i) => { o.place = i + 1; });
  broadcast({ t: 'results', order });
  resetTimer = setTimeout(backToLobby, RESULTS_MS);
}
function backToLobby() {
  clearTimeout(resetTimer); resetTimer = null;
  if (race) { clearTimeout(race.graceTimer); race.timers.forEach(clearTimeout); }
  race = null; phase = 'lobby'; hostBanned.clear(); hostClips = 0;
  for (const p of players.values()) { p.ready = false; p.inRace = false; p.dnf = false; p.slot = null; }
  pickHost();
  sendLobby();
}

// ---------- mensajes ----------
// cambios de lobby (nick/color/ready) max 5/s por jugador: evita amplificar difusiones
function lobbyOk(p) {
  const n = now();
  if (n - (p.lobbyT || 0) > 1000) { p.lobbyT = n; p.lobbyN = 0; }
  return ++p.lobbyN <= 5;
}
function onMessage(p, m) {
  switch (m.t) {
    case 'hello':
      if (p.hello) return;
      p.hello = true;
      p.nick = uniqueNick(m.nick, p.id);
      p.color = freeColor(m.color, p.id);
      pickHost();
      send(p.ws, { t: 'welcome', id: p.id, nick: p.nick, hostId, serverNow: now(), phase, seed: race ? race.seed : null, maxPlayers: MAX_PLAYERS, color: p.color, palette: COLORS, shareUrls: shareUrls(), consts: C });
      sendLobby();
      return;
    case 'ping': return send(p.ws, { t: 'pong', serverNow: now() });
  }
  if (!p.hello) return;
  switch (m.t) {
    case 'nick':
      if (phase !== 'lobby' || !lobbyOk(p)) return;
      p.nick = uniqueNick(m.nick, p.id); sendLobby(); return;
    case 'color':
      if (phase !== 'lobby' || !lobbyOk(p)) return;
      p.color = freeColor(m.color, p.id); sendLobby(); return;
    case 'ready':
      if (phase !== 'lobby' || typeof m.ready !== 'boolean' || !lobbyOk(p)) return;
      p.ready = m.ready; sendLobby(); maybeStart(); return;
    case 'state': {
      if (!race || phase !== 'race' || !p.inRace || p.dnf || race.done.has(p.slot) || now() < race.startAt) return;
      const raw = { p: num(m.p, -1e6, 1e6), x: num(m.x, -1e6, 1e6), vp: num(m.vp, -1e6, 1e6), vx: num(m.vx, -1e6, 1e6) };
      if (raw.p === null || raw.x === null || raw.vp === null || raw.vx === null) return;
      const prevP = p.mv.p;
      if (applyMove(p.mv, raw, C.MAX_SPEED, race.startAt, now())) p.clips++;
      checkRamps(p.mv, prevP, p.slot, now());
      tryFinishPlayer(p);
      return;
    }
    case 'bots': {
      if (!race || phase !== 'race' || p.id !== hostId || hostBanned.has(p.id) || !Array.isArray(m.list) || now() < race.startAt) return;
      for (const b of m.list.slice(0, 7)) {
        if (!b || !Number.isInteger(b.slot) || b.slot < 0 || b.slot > 7 || race.slots[b.slot].kind !== 'bot' || race.done.has(b.slot)) continue;
        const raw = { p: num(b.p, -1e6, 1e6), x: num(b.x, -1e6, 1e6), vp: num(b.vp, -1e6, 1e6), vx: num(b.vx, -1e6, 1e6) };
        if (raw.p === null || raw.x === null || raw.vp === null || raw.vx === null) continue;
        const st = race.bots.get(b.slot);
        const prevP = st.p;
        if (applyMove(st, raw, C.BOT_CAP, race.startAt, now())) hostClips++;
        checkRamps(st, prevP, b.slot, now());
        st.fromHost = now();
      }
      if (hostClips > HOST_STRIKES) demoteHost(p);
      return;
    }
    case 'botfinish':
      if (race && phase === 'race' && p.id === hostId && !hostBanned.has(p.id) && Number.isInteger(m.slot) && m.slot >= 0 && m.slot < 8 && race.slots[m.slot].kind === 'bot')
        tryFinishBot(m.slot);
      return;
    case 'finish':
      if (race && p.inRace && !p.dnf) { p.wantFinish = true; tryFinishPlayer(p); }
      return;
    case 'kirk': {      // codigo secreto: OVNI (impulso al autor + laser que aturde a los demas), 1 vez por carrera
      if (!race || phase !== 'race' || now() < race.startAt || !p.inRace || p.dnf || !p.mv || !p.mv.init || race.done.has(p.slot)) return;
      const tn = now();
      if ((p.ufoUsed || 0) >= C.UFO_PER_RACE || tn < (p.mv.stunUntil || 0)) return;
      p.ufoUsed = (p.ufoUsed || 0) + 1;
      p.mv.ufoUntil = tn + C.UFO_BOOST_S * 1000;
      p.mv.envBonus = (p.mv.envBonus || 0) + (C.UFO_BOOST - 1) * C.UFO_BOOST_S;
      broadcast({ t: 'ufo', from: p.slot, id: p.id, serverNow: tn, boostUntil: p.mv.ufoUntil, stunUntil: tn + C.UFO_STUN_S * 1000 });
      for (const s of race.slots) if (s.slot !== p.slot) tryStun(s.slot, tn, C.UFO_STUN_S * 1000);   // respeta inmunidad y aire
      return;
    }
    case 'pickup': onPickup(p, m); return;
    case 'fire': onFire(p, m); return;
    case 'event': {
      if (!race || phase !== 'race' || !p.inRace || p.dnf || typeof m.kind !== 'string' || !/^[a-zA-Z0-9_]{1,16}$/.test(m.kind)) return;
      if (now() - (p.lastEvent || 0) < 150) return;
      p.lastEvent = now();
      broadcast({ t: 'event', id: p.id, kind: m.kind, data: sanitizeData(m.data) }, p.id);
      return;
    }
  }
}

// ---------- power-ups: cajas, bazooka, stun ----------
function schedule(r, ms, fn) {            // temporizador atado a la carrera: se descarta si cambia
  const h = setTimeout(() => { r.timers.delete(h); if (race === r) fn(); }, ms);
  r.timers.add(h);
}
// actor de pickup/fire: el propio jugador o (solo el host efectivo) un bot por slot
function actorOf(p, m) {
  if (!race || phase !== 'race' || now() < race.startAt) return null;
  if (m.slot !== undefined && m.slot !== p.slot) {
    if (p.id !== effectiveHost() || !Number.isInteger(m.slot) || m.slot < 0 || m.slot > 7) return null;
    const s = race.slots[m.slot]; const st = race.bots.get(m.slot);
    if (!s || s.kind !== 'bot' || !st || !st.init || race.done.has(m.slot)) return null;
    return { slot: m.slot, mv: st, bot: true };
  }
  if (!p.inRace || p.dnf || !p.mv || !p.mv.init || race.done.has(p.slot)) return null;
  return { slot: p.slot, mv: p.mv, bot: false, p };
}
const getItem = a => a.bot ? race.botItems.get(a.slot) || null : a.p.item;
const setItem = (a, k) => { if (a.bot) { k ? race.botItems.set(a.slot, k) : race.botItems.delete(a.slot); } else a.p.item = k; };
function actOk(slot) {                      // 1 accion cada ACT_GAP_MS por pato
  const n = now(), l = race.lastAct.get(slot) || 0;
  if (n - l < ACT_GAP_MS) return false;
  race.lastAct.set(slot, n); return true;
}
function sendItem(a, kind) {
  const msg = { t: 'item', slot: a.slot, kind };
  const to = a.bot ? players.get(effectiveHost()) : a.p;
  if (to) send(to.ws, msg);
}
function onPickup(p, m) {
  const a = actorOf(p, m);
  if (!a || !Number.isInteger(m.box) || !actOk(a.slot)) return;
  const b = race.boxes[m.box];
  if (!b || !b.active || getItem(a)) return;
  if (Math.abs(a.mv.p - b.p) >= BOX_DP || Math.abs(a.mv.x - b.x) >= BOX_DX) return;   // posicion validada por el servidor
  b.active = false;
  const kind = b.kind;   // el item es exactamente el kind visible de la caja
  setItem(a, kind);
  sendItem(a, kind);
  broadcast({ t: 'boxTaken', box: b.id, slot: a.slot });
  schedule(race, BOX_RESPAWN_MS, () => { b.active = true; b.kind = randomKind(); broadcast({ t: 'boxBack', box: b.id, kind: b.kind }); });
}
function slotPos(slot) {
  const s = race.slots[slot];
  if (s.kind === 'bot') return race.bots.get(slot);
  const q = players.get(s.id);
  return q && q.inRace && !q.dnf ? q.mv : null;
}
// aturde si el pato esta en carrera y ni inmune, ni aturdido, ni en el aire
function tryStun(slot, tn, ms = STUN_MS) {
  const mv = slotPos(slot);
  if (!mv || !mv.init || race.done.has(slot) || tn < (mv.immuneUntil || 0) || tn < (mv.stunUntil || 0) || tn < (mv.airUntil || 0) || tn < (mv.giantUntil || 0)) return false;
  mv.stunUntil = tn + ms; mv.immuneUntil = mv.stunUntil + IMMUNE_MS; mv.stunLost = (mv.stunLost || 0) + ms / 1000;
  broadcast({ t: 'stun', slot, id: race.slots[slot].id, until: mv.stunUntil, serverNow: tn });
  return true;
}
// megafono: aturde a los SHOUT_N patos mas cercanos al que grita (distancia en (p,x), jugadores y bots, delante o detras);
// el que grita no se aturde; inmunes y patos en el aire cuentan entre los cercanos pero no se ven afectados.
function shout(a) {
  const tn = now(), near = [];
  for (const s of race.slots) {
    if (s.slot === a.slot || race.done.has(s.slot)) continue;
    const mv = slotPos(s.slot);
    if (mv && mv.init) near.push({ slot: s.slot, d: Math.hypot(mv.p - a.mv.p, mv.x - a.mv.x) });
  }
  near.sort((u, v) => u.d - v.d || u.slot - v.slot);
  const targets = near.slice(0, C.SHOUT_N).map(n => n.slot);
  broadcast({ t: 'shout', from: a.slot, p: Math.round(a.mv.p * 100) / 100, x: Math.round(a.mv.x * 100) / 100, targets, serverNow: tn });
  for (const s of targets) tryStun(s, tn);
}
// choque del gigante: lo detecta el servidor (loop de snap) con posiciones saneadas; no existe mensaje del cliente.
// Cada objetivo solo puede ser aturdido por embestida 1 vez cada BUMP_GAP_MS; tryStun respeta inmunidad, aire y gigantes.
function giantHits(tn) {
  for (const s of race.slots) {
    const g = slotPos(s.slot);
    if (!g || !g.init || tn >= (g.giantUntil || 0) || race.done.has(s.slot) || tn < (g.stunUntil || 0)) continue;
    for (const o of race.slots) {
      if (o.slot === s.slot || race.done.has(o.slot)) continue;
      const mv = slotPos(o.slot);
      if (!mv || !mv.init || Math.hypot(mv.p - g.p, mv.x - g.x) > C.GIANT_BUMP_R) continue;
      if (tn - (race.bumpAt.get(o.slot) || 0) < BUMP_GAP_MS) continue;
      if (tryStun(o.slot, tn, C.GIANT_BUMP_STUN_S * 1000)) race.bumpAt.set(o.slot, tn);
    }
  }
}
function onFire(p, m) {
  const a = actorOf(p, m);
  if (!a || !getItem(a) || !actOk(a.slot)) return;
  if (now() < (a.mv.stunUntil || 0)) return;               // aturdido no dispara
  const item = getItem(a);
  setItem(a, null);
  if (item === 'megafono') return shout(a);
  if (item === 'gigante') {
    const tn = now(); a.mv.giantUntil = tn + C.GIANT_S * 1000;
    return broadcast({ t: 'giant', slot: a.slot, id: race.slots[a.slot].id, until: a.mv.giantUntil, serverNow: tn });
  }
  // objetivo: el pato con menor p mayor que el del tirador (jugador o bot, aun en carrera)
  let tgt = null, tp = Infinity;
  for (const s of race.slots) {
    if (s.slot === a.slot || race.done.has(s.slot)) continue;
    const mv = slotPos(s.slot);
    if (mv && mv.init && mv.p > a.mv.p && mv.p < tp) { tgt = s.slot; tp = mv.p; }
  }
  const t0 = now();
  if (tgt === null) { broadcast({ t: 'missile', from: a.slot, target: null, t0, eta: 0, serverNow: t0 }); return; }
  const eta = Math.round(clamp(0.6 + (tp - a.mv.p) / 50, 0.6, 1.6) * 1000);
  broadcast({ t: 'missile', from: a.slot, target: tgt, t0, eta: eta / 1000, serverNow: t0 });
  schedule(race, eta, () => {
    if (!tryStun(tgt, now())) broadcast({ t: 'miss', from: a.slot, target: tgt });
  });
}

// El host que manda bots imposibles pierde el rol; si no hay otro, el servidor simula los bots.
function demoteHost(p) {
  hostBanned.add(p.id);
  hostClips = 0;
  const next = [...players.values()].find(q => !hostBanned.has(q.id) && q.hello);
  if (next) hostId = next.id;
  console.log(`host ${p.id} degradado por bots imposibles`);
  sendLobby();
}

// relevo de snapshots ~15 Hz: siempre posiciones saneadas por el servidor
const r2 = v => Math.round(v * 100) / 100;
function effectiveHost() { return hostId !== null && !hostBanned.has(hostId) ? hostId : null; }
setInterval(() => {
  if (phase !== 'race' || !race) return;
  const tn = now();
  if (tn < race.startAt) return;
  const eh = effectiveHost();
  // bots sin datos recientes del host: el servidor los avanza en linea recta a velocidad media
  for (const [slot, st] of race.bots) {
    if (race.done.has(slot) || (st.fromHost && tn - st.fromHost < BOT_STALE_MS)) continue;
    if (tn < (st.stunUntil || 0)) { st.tp = tn; continue; }
    const dt = clamp((tn - st.tp) / 1000, 0, 1);
    const prevP = st.p;
    st.p = Math.min(st.p + C.BOT_AVG * dt, C.LENGTH + 1); checkRamps(st, prevP, slot, tn); st.vp = C.BOT_AVG; st.vx = 0; st.tp = tn; st.init = true;
    tryFinishBot(slot);
    if (!race) return;
  }
  giantHits(tn);
  const ps = [...players.values()].filter(p => p.inRace && !p.dnf && p.mv && p.mv.init)
    .map(p => ({ id: p.id, p: r2(p.mv.p), x: r2(p.mv.x), vp: r2(p.mv.vp), vx: r2(p.mv.vx), fin: race.done.has(p.slot) }));
  const bs = [...race.bots].map(([slot, st]) => ({ slot, p: r2(st.p), x: r2(st.x), vp: r2(st.vp), vx: r2(st.vx) }));
  for (const p of players.values()) {
    if (p.ws.readyState !== 1 || !p.inRace) continue;
    send(p.ws, { t: 'snap', players: ps.filter(s => s.id !== p.id), bots: p.id === eh ? [] : bs });
  }
}, 66);

function onLeave(p) {
  if (!players.delete(p.id)) return;
  if (p.hello) {
    broadcast({ t: 'left', id: p.id });
    if (p.id === hostId) { hostId = null; pickHost(); }
    if (race && p.inRace) { p.dnf = true; if (phase !== 'results') checkEnd(); }
    if (players.size === 0) { backToLobby(); return; }
    sendLobby();
    if (phase === 'lobby') maybeStart();
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'sala llena' }); return ws.close(1013); }
  const p = { ws, id: nextId++, nick: '', ready: false, hello: false, tokens: BURST, last: now(), strikes: 0, inRace: false, dnf: false, slot: null };
  players.set(p.id, p);
  const hb = setTimeout(() => { if (!p.hello) ws.close(1008); }, 10000);   // sin hello en 10 s fuera
  ws.on('message', (data, isBinary) => {
    const t = now();
    p.tokens = Math.min(BURST, p.tokens + (t - p.last) * RATE / 1000); p.last = t;
    if (p.tokens < 1) { if (++p.strikes > 200) ws.close(1008, 'rate'); return; }
    p.tokens -= 1;
    if (isBinary || data.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    try { onMessage(p, m); } catch (e) { console.error('msg error', e.message); }
  });
  ws.on('close', () => { clearTimeout(hb); onLeave(p); });
  ws.on('error', () => {});
});

server.listen(PORT, () => console.log(`duckdowns escuchando en :${PORT}`));
process.on('SIGTERM', () => process.exit(0));
