/* modmenu.js - mod menu oculto (Alt+T), en lobby y en carrera. Script clasico: window.DuckMod.
   Cheats (cada uno on/off): velocidad maxima xK, invulnerable (stuns, obstaculos, choques, donas), municion infinita
   de CANGRI (tecla C) y KIRK (tecla K), bomba atomica infinita (tecla B). Red: C->S mod{speed,god,inf,bomb}, nuke{};
   S->C modList{ids} solo a quien abrio el menu.
   La etiqueta roja "MODO EPSTEIN" solo la ven quienes abrieron el mod menu. Contrato de modulo: init/update/onNet. */
(function () {
'use strict';
const KEY = 'duck.mod', SPEED_MIN = 1.2, SPEED_MAX = 2.5;
let api = null, panel = null, els = {}, tagged = new Set(), sendT = 0;
const st = { holder: false, open: false, speedOn: false, speed: 1.6, god: false, inf: false, bomb: false };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}'), { open: false }); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
const active = () => st.holder && (st.speedOn || st.god || st.inf || st.bomb);
const refresh = () => { if (typeof window.__modRefresh === 'function') window.__modRefresh(); };

function sync() {   // manda el estado al servidor (agrupado: el servidor limita 5 cambios/s)
  save(); render(); refresh();
  if (!api || !st.holder) return;
  clearTimeout(sendT);
  sendT = setTimeout(() => api.send({ t: 'mod', speed: st.speedOn ? st.speed : 1, god: st.god, inf: st.inf, bomb: st.bomb }), 120);
}

const CHEATS = [   // [clave de st, nombre, ayuda]
  ['speedOn', 'Velocidad máxima', ''],
  ['god', 'Invulnerable', 'stuns, obstáculos, choques y donas'],
  ['inf', 'Munición infinita', 'C = CANGRI · K = KIRK'],
  ['bomb', 'Bomba atómica infinita', 'B = lanzar (5 s de cuenta atrás)'],
];
const AUTO_SPEED = 2;   // "activar todo" ajusta la velocidad sola
function build() {
  const css = document.createElement('style');
  css.textContent =
    '#modMenu{position:fixed;right:14px;top:50%;transform:translateY(-50%);width:270px;z-index:50;display:none;' +
    'font:600 14px Fredoka,"Trebuchet MS",sans-serif;color:#fff;background:rgba(18,6,10,.88);border:2px solid #ff2d3d;border-radius:14px;' +
    'box-shadow:0 0 24px rgba(255,45,61,.45);padding:12px 14px;user-select:none}' +
    '#modMenu.on{display:block}#modMenu h3{margin:0 0 8px;font-size:17px;color:#ff2d3d;letter-spacing:1px;text-align:center}' +
    '#modMenu .row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0}' +
    '#modMenu button{font:800 12px Fredoka,"Trebuchet MS",sans-serif;border:0;border-radius:8px;padding:6px 9px;cursor:pointer;min-width:94px;color:#fff;background:#3b8f4a}' +
    '#modMenu button.off{background:#b3172b}#modMenu button.all{width:100%;font-size:15px;padding:9px;margin-bottom:4px}' +
    '#modMenu input[type=range]{width:100%;accent-color:#ff2d3d}#modMenu small{display:block;opacity:.7;font-weight:400;font-size:12px}' +
    '#modMenu .ft{margin-top:8px;font-size:11px;opacity:.6;text-align:center}';
  document.head.appendChild(css);
  panel = document.createElement('div'); panel.id = 'modMenu';
  panel.innerHTML = '<h3>MODO EPSTEIN</h3><button class="all" id="mmAll"></button>' +
    CHEATS.map(([k, name, help]) => '<div class="row"><span>' + name + (k === 'speedOn' ? ' <b id="mmSpv"></b>' : '') +
      (help ? '<small>' + help + '</small>' : '') + '</span><button data-k="' + k + '"></button></div>' +
      (k === 'speedOn' ? '<input type="range" id="mmSpr" min="' + SPEED_MIN + '" max="' + SPEED_MAX + '" step="0.1">' : '')).join('') +
    '<div class="ft">Alt+T para cerrar</div>';
  document.body.appendChild(panel);
  els.all = panel.querySelector('#mmAll'); els.mmSpr = panel.querySelector('#mmSpr'); els.mmSpv = panel.querySelector('#mmSpv');
  els.btns = [...panel.querySelectorAll('button[data-k]')];
  // que los clicks/teclas del panel no lleguen al juego (disparar item, nadar)
  for (const ev of ['mousedown', 'pointerdown', 'keydown', 'keyup']) panel.addEventListener(ev, e => e.stopPropagation());
  for (const b of els.btns) b.addEventListener('click', () => { const k = b.dataset.k; st[k] = !st[k]; sync(); });
  els.all.addEventListener('click', () => {   // boton explicito: todo encendido (con valores automaticos) o todo apagado
    const on = !CHEATS.every(([k]) => st[k]);
    for (const [k] of CHEATS) st[k] = on;
    if (on) st.speed = AUTO_SPEED;
    sync();
  });
  els.mmSpr.addEventListener('input', () => { st.speed = Math.round(+els.mmSpr.value * 10) / 10; sync(); });
  render();
}
function render() {
  if (!panel) return;
  panel.classList.toggle('on', st.open);
  els.mmSpr.value = st.speed; els.mmSpv.textContent = '×' + st.speed.toFixed(1);
  for (const b of els.btns) { const on = !!st[b.dataset.k]; b.textContent = on ? 'DESACTIVAR' : 'ACTIVAR'; b.classList.toggle('off', on); }
  const all = CHEATS.every(([k]) => st[k]);
  els.all.textContent = all ? 'DESACTIVAR TODO' : 'ACTIVAR TODO'; els.all.classList.toggle('off', all);
}

/* ---------- KIRK / CANGRI con una sola tecla (municion infinita) ---------- */
function stunOthers(ms) {
  const n = api.now(), me = api.me, R = api.racers;
  for (let i = 0; i < R.length; i++) { const r = R[i]; if (r !== me && !r.dead && n >= (r.airUntil || 0) && n >= (r.giantUntil || 0)) r.stunUntil = n + ms; }
}
function fireCode(k) {
  const me = api.me, U = window.DuckUfo, C = api.consts;
  if (!me || me.finished || me.dead || api.now() < (me.stunUntil || 0)) return;
  if (k === 'b') { if (api.isOnline()) api.send({ t: 'nuke' }); else if (window.DuckNuke) window.DuckNuke.offlineFire(me); return; }
  if (api.isOnline()) { api.send({ t: k === 'k' ? 'kirk' : 'cangri' }); return; }
  if (!U) return;   // offline: mismos efectos que manda el servidor
  if (k === 'k') { U.onNet({ t: 'ufo', from: me.slot, boostUntil: api.now() + (C.UFO_BOOST_S || 1.5) * 1000 }); stunOthers((C.UFO_STUN_S || 3) * 1000); }
  else { U.onNet({ t: 'cangri', from: me.slot }); stunOthers(1000); }
}
function onKey(e) {
  if (e.altKey && e.code === 'KeyT') {   // Alt+T: abrir/cerrar (en cualquier pantalla)
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    st.open = !st.open; st.holder = true; sync(); return;
  }
  if (!st.holder || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = st.inf && e.code === 'KeyK' ? 'k' : st.inf && e.code === 'KeyC' ? 'c' : st.bomb && e.code === 'KeyB' ? 'b' : '';
  const g = window.__game;
  if (!k || !g || g.state !== 'race' || !api.me) return;
  e.preventDefault(); e.stopImmediatePropagation();   // no llega a la secuencia K-I-R-K / C-A-N-G-R-I normal
  fireCode(k);
}

window.DuckMod = {
  init(a) {
    api = a; build();
    window.addEventListener('keydown', onKey, true);   // captura: antes que el juego y que ovni.js
  },
  // carrera.html: tope de velocidad / empuje del jugador, invulnerabilidad local y etiqueta
  speedK() { return st.holder && st.speedOn ? st.speed : 1; },
  god() { return st.holder && st.god; },
  tagged(r) { return active() && (r.isPlayer || tagged.has(r.id)); },   // solo lo ve quien tiene algun cheat activo
  update() {
    const me = api && api.me;   // offline no hay servidor que filtre los stuns: se anulan aqui
    if (me && st.holder && st.god && !api.isOnline() && (me.stunUntil || 0) > api.now()) me.stunUntil = 0;
  },
  onNet(m) {
    if (m.t === 'modList') { tagged = new Set(m.ids); refresh(); }
  },
  onWelcome() { if (st.holder) sync(); },   // reconexion: el servidor vuelve a saber que tengo el mod
};
})();
