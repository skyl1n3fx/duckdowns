# Protocolo multijugador (v1)

WebSocket en `/ws` (mismo origen que `carrera.html`): `new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')`.
JSON de texto, max 4 KB. Campo `t` = tipo. Tiempos de reloj en ms epoch del servidor; `t`/tiempos de carrera en segundos.
Campos de movimiento (nombres de Natsuki): `p` progreso hacia meta (unidades, 0..LENGTH), `x` lateral, `vp` vel. de avance, `vx` vel. lateral.

## Cliente -> Servidor
| t | campos | notas |
|---|---|---|
| `hello` | `nick`, `color?` | primer mensaje obligatorio. `color` = entero 0xRRGGBB de la paleta. |
| `color` | `color` | cambia color (solo lobby). Si esta tomado o no esta en la paleta, el servidor asigna el primer libre. |
| `nick` | `nick` | cambia nick (solo en lobby). |
| `ready` | `ready:bool` | solo en lobby. |
| `state` | `p,x,vp,vx,fin?` | 15-20 Hz en carrera; se relaya con `id`. |
| `bots` | `list:[{slot,p,x,vp,vx}]` | solo el host, 15-20 Hz (<=7). |
| `botfinish` | `slot` | solo host: un bot cruzo la meta. |
| `finish` | `time` | mi tiempo en s desde `startAt`. Orden = orden de recepcion. |
| `event` | `kind, data?` | opcional; se relaya con `id`. |
| `ping` | - | responde `pong`. |

## Servidor -> Cliente
- `welcome`: `{id, nick, color, palette:[10 enteros 0xRRGGBB], shareUrls:[...], hostId, serverNow, phase:'lobby'|'countdown'|'race'|'results', seed|null, maxPlayers:8}` seguido de un `lobby`.
- `lobby`: `{players:[{id,nick,ready,host,color}], hostId, phase, shareUrls:[...]}` en cada cambio. Quien entra durante `race`/`results` ve esa fase y espera.
- `start`: `{seed, startAt, serverNow, slots:[8 x {slot,id|null,nick,kind:'player'|'bot',color}], hostId}`.
  `color` = entero 0xRRGGBB (el elegido por el jugador, unico; los bots usan colores sobrantes de la paleta). `slot` 0..7 = carril/posicion de salida. `startAt = serverNow+4000` (con un solo jugador en el lobby: `serverNow+1500`);
  cliente: `offset = serverNow - Date.now()`; arranca en `startAt - offset`. Quien entra tarde no recibe `start`.
- `snap`: `{players:[{id,p,x,vp,vx,fin}], bots:[{slot,p,x,vp,vx}]}` ~15 Hz (jugadores sin el receptor; `bots` solo a no-host).
- `finished`: `{id|null, slot, place, time}` (jugador o bot).
- `results`: `{order:[{slot,id|null,kind,nick,place,time|null}]}` los 8 ordenados. Se emite cuando todos los jugadores vivos terminaron o 60 s tras el primer `finish`; el resto (bots sin `botfinish`, jugadores DNF) va al final por `p` mas alto conocido.
- `event`: `{id,kind,data}`; `left`: `{id}`; `pong`: `{serverNow}`; `error`: `{msg}`.

## Reglas
- Arranca cuando todos los del lobby estan `ready` (>=1). Bots = 8 - jugadores. Host = primer jugador (se reasigna al salir; `lobby.hostId`).
- ~15 s tras `results` vuelve a `lobby` con ready=false.
- Si alguien sale en carrera: `left{id}`, su pato se quita y su slot queda fuera de la carrera (DNF).
- Colores: paleta fija de 10 (ver `welcome.palette`), unica por jugador; el servidor responde siempre con `lobby` actualizado, el cliente debe leer su color ahi.
- Nick 1-16 chars, sin control chars ni `<>&"'\``; unico (sufijo ` 2`); vacio -> `Pato N`. Max 8 jugadores (el 9o recibe `error`).
- Tasa ~40 msg/s (rafaga 60); exceso se descarta y si persiste se cierra. Numeros no finitos o fuera de rango se descartan.
- Obstaculos e IA de bots se generan de `rng(seed)` en todos los clientes; solo el host simula/emite bots.
- `shareUrls` (en `welcome` y `lobby`): URLs para invitar, en orden: `PUBLIC_URL` (variable de entorno del servidor, si es http/https valida), una por cada IPv4 no interna (`http://<ip>:PORT/carrera.html`) y `http://localhost:PORT/carrera.html`. El lobby debe mostrarlas (con boton copiar). Las IPs son las del servidor, utiles en LAN.

## Anti-trampa (el servidor es la autoridad)
Constantes unicas en `server.js` (`C`), enviadas en `welcome.consts`: `LENGTH=1200 (por defecto; env DUCK_LENGTH solo para tests), HALF_W=11, MAX_SPEED=15, BOT_MAX=14.2, BOT_RUBBER=0.12, BOT_AVG=12.5, BOT_CAP=BOT_MAX*(1+BOT_RUBBER)+0.6`. El cliente debe usar estos valores.
- `state`: se valida con el reloj del servidor. `p` solo puede avanzar `MAX_SPEED*1.5*dt+1` por mensaje y nunca superar `MAX_SPEED*1.05*(tiempo desde startAt)+3`; retroceso max 10 u/s; `|x|<=HALF_W+0.5` y desplazamiento lateral <=30 u/s; `|vp|<=MAX_SPEED*1.1`, `|vx|<=30`. Lo que se recorta se recorta, no se rechaza el mensaje. Se ignora todo `state` antes de `startAt`. `fin` del cliente se ignora.
- `snap` lleva SIEMPRE la posicion saneada por el servidor (puede diferir de la tuya si fuiste recortado). El receptor no recibe su propia entrada; si el cliente quiere corregirse debe usar un `snap`/`state` propio futuro (no implementado: pide a Kenji si hace falta).
- `finish{time}`: el campo `time` se ignora. Vale solo si el `p` validado >= `LENGTH-2` y el tiempo de servidor desde `startAt` >= `LENGTH/MAX_SPEED` (34.7 s); si el `finish` llega antes, queda pendiente y se concede cuando el `p` validado alcance la meta. `finished.time` / `results.order[].time` = reloj de servidor en segundos.
- Bots: solo el host efectivo puede mandar `bots`/`botfinish`; cada bot se valida igual con `BOT_CAP`. `botfinish{slot}` vale solo si ese bot (validado) llego a meta. Si el host acumula >40 recortes de bots pierde el rol (`lobby.hostId` cambia en plena carrera: el nuevo host debe empezar a simular y mandar `bots`; el degradado deja de recibirlos de vuelta). Bots sin datos del host >600 ms los avanza el servidor en linea recta a `BOT_AVG` (si no hay otro host valido, el servidor los simula solos).
- `event`: `kind` /^[A-Za-z0-9_]{1,16}$/, 1 cada 150 ms, `data` saneado (profundidad 2, strings <=32 sin `<>&"'`` , numeros finitos, <=8 claves/items). Solo en carrera.
- Lobby: `nick`/`color`/`ready` siempre actuan sobre quien envia (no existe campo de destino; ids forjados se ignoran), solo en fase lobby, max 5 cambios/s por jugador.
- Limite honesto: un tramposo no puede ir mas rapido que un jugador legitimo al tope de velocidad, pero si puede ir siempre al tope (no hay verificacion de pulsaciones).

## Power-ups y rampas (fase 3)
Constantes extra en `welcome.consts`: `JUMP_S=1, JUMP_BOOST=1.25, SHOUT_N=3, STUN_S=2, IMMUNE_S=1, BOX_RESPAWN_S=6`.
`start` incluye `boxes:[{id,p,x,kind}]` (`kind` = item que dara la caja: `'bazooka'|'megafono'|'gigante'`, elegido al azar por el servidor al generarla y en cada reaparicion; `pickup` entrega exactamente ese `kind`; `boxBack{box,kind}` trae el nuevo) (3 por fila, ~9 filas entre p=60 y LENGTH-40) y `ramps:[{id,p,x,w}]` (una entre cada par de filas, >=20 u de cualquier caja). Los genera el servidor; no hay PRNG compartido.

C->S (el `slot` solo lo puede usar el host efectivo, para sus bots; sin `slot` actua el propio jugador; 1 accion cada 150 ms por pato):
- `pickup{box, slot?}`: valido si la caja esta activa, el pato (posicion VALIDADA) esta a |dp|<2.5 y |dx|<2, y no lleva item. Si lleva item se rechaza en silencio y la caja NO se consume.
- `fire{slot?}`: solo con item y no aturdido.

S->C:
- `item{slot, kind:'bazooka'|'megafono'|'gigante'|'dona'}` al dueno (a los bots, al host). `kind` = el de la caja recogida. Maximo 1 item.
- `boxTaken{box, slot}` a todos; `boxBack{box,kind}` a los 6 s.
- bazooka: `missile{from, target|null, t0, eta, serverNow}` (target = pato con menor `p` mayor que el del tirador, jugador o bot; null = se pierde). Al impactar (`eta` s) llega `stun` o `miss{from,target}` (si el objetivo esta en el aire, inmune o ya aturdido).
- megafono: `shout{from,p,x,targets:[slot x3],serverNow}` inmediato: los 3 patos mas cercanos en distancia (p,x), delante o detras, jugadores y bots (excluye al que grita; los del aire/inmunes cuentan entre los 3 pero no se ven afectados). Luego un `stun` por cada afectado.
- `stun{slot,id,until,serverNow}`: aturdido 2 s (reloj de servidor). Durante el stun el servidor no deja avanzar `p` (deriva <=0.5 u/s, `vp` <=1). Inmunidad de 1 s tras el stun.
- `jump{slot,id,ramp,until,serverNow}`: lo decide el servidor cuando la posicion validada cruza `p` de la rampa con `|x-ramp.x|<w/2` (una vez por rampa). 1 s de aire: tope de velocidad x1.25 (honestos no se recortan); los obstaculos y choques no aplican y misiles/megafono no le afectan (eso lo respeta el servidor; los obstaculos/choques los resuelve el cliente).
- Anti-trampa: la envolvente de `p` se reduce 2 s por cada stun y se amplia 0.25 s por salto; un cliente aturdido que sigue mandando avance es congelado en `snap`.
- El cliente NO debe aplicar el stun solo: espera `stun` del servidor (puede cliente-predecir el misil con `missile`).

## Codigo secreto KIRK (OVNI)
- C->S `kirk{}`: el cliente lo manda al completar la secuencia K-I-R-K. Solo vale en fase `race` ya iniciada (no en lobby ni cuenta atras), si el pato esta en carrera y no ha llegado a meta. No hay campo de destino: el autor es siempre quien envia. Los bots no usan KIRK.
- Reglas: **3 usos por jugador por carrera** (`UFO_PER_RACE`) con **cooldown de 15 s** entre usos (`UFO_COOLDOWN_S`); no se puede usar aturdido. Un `kirk` sin usos, en cooldown o aturdido se rechaza y el servidor responde `kirkNo{usesLeft,cooldownUntil,serverNow}` (el HUD toma estos valores como autoridad). Fuera de carrera/cuenta atras se descarta en silencio.
- S->C `kirkState{usesLeft,cooldownUntil,serverNow}` al jugador al iniciar la carrera (3 usos, cooldownUntil=0) y tras cada uso. `cooldownUntil` en ms de reloj de servidor.
- S->C `ufo{from:<slot del activador>, id, serverNow, boostUntil, stunUntil, usesLeft, cooldownUntil}` a todos (efectos alienigenas para todo el servidor; `usesLeft`/`cooldownUntil` son del autor).
- Impulso: x1.4 (`UFO_BOOST`) durante 1.5 s (`UFO_BOOST_S`) para el activador; el servidor amplia tope de velocidad y envolvente (+0.6 s equivalentes), asi que no se recorta. Pasado `boostUntil` vuelve al tope normal.
- Laser: `stun` de 3 s (`UFO_STUN_S`) a TODOS los demas patos (jugadores y bots), uno `stun{slot,id,until,serverNow}` por afectado; el autor no se aturde; respeta inmunidad de 1 s post-stun, a los del aire (rampa) y a los gigantes (no se ven afectados).
- `welcome.consts`: `UFO_BOOST=1.4, UFO_BOOST_S=1.5, UFO_STUN_S=3, UFO_PER_RACE=3, UFO_COOLDOWN_S=15`.

## Gigante (3er power-up)
- Consts en `welcome.consts`: `GIANT_S=4, GIANT_SCALE=3, GIANT_BUMP_R=4, GIANT_BUMP_STUN_S=2`.
- `fire` con item `gigante` -> `giant{slot,id,until,serverNow}` a todos: durante `GIANT_S` s el pato se dibuja `GIANT_SCALE` veces mas grande.
- Inmunidad: mientras dura es inmune a todo stun (misil -> `miss{from,target}`; megafono y OVNI/KIRK no le hacen nada; cuenta entre los 3 del megafono pero no se aturde). Un gigante tampoco se aturde por el choque de otro gigante.
- Choque: **lo detecta el servidor** (cada ~66 ms, con posiciones saneadas): todo pato (jugador o bot) a distancia `hypot(dp,dx) <= GIANT_BUMP_R` (=4, ya incluye el tamano escalado) de un gigante recibe `stun{slot,id,until,serverNow}` de `GIANT_BUMP_STUN_S`=2 s. Maximo 1 por objetivo cada 2.5 s; respeta inmunidad de 1 s post-stun y los del aire. **No existe `bump` cliente->servidor** (cualquier `bump` se ignora): el cliente solo anima cuando llega el `stun`.
- El gigante puede seguir usando KIRK (si no esta aturdido). Los bots gigantes los dispara el host con `fire{slot}` igual que los demas items.

## Dona (4o power-up: trampa)
- `welcome.consts`: `DONUT_R_X=3, DONUT_R_P=1.5, DONUT_BLIND_S=3, DONUT_SPLASH_R=10, DONUT_SPLASH_S=1.5, DONUT_ARM_S=1.5, DONUT_TTL_S=60, DONUT_MAX=6`.
- `fire` con `dona`: el servidor deja una trampa en la posicion saneada del pato, 2 u detras (`p-2`), con rectangulo de `|dx|<=DONUT_R_X` y `|dp|<=DONUT_R_P` (2 carriles), fija en p. Broadcast `trapAdd{id,by:<slot>,p,x,r:DONUT_R_X,rp:DONUT_R_P,serverNow,armAt,expireAt}` (ms de reloj de servidor). `welcome.traps` y `start.traps` traen las trampas activas (`start.traps` va vacio al empezar).
- Activacion (servidor, loop de snap, posiciones saneadas, barrido en p entre ticks): el primer pato (jugador o bot) que entra al rectangulo. El autor no la activa hasta `armAt` (1.5 s despues de dejarla). Los patos en el aire (rampa) y los gigantes pasan por encima: ni la activan ni la consumen.
- `donut{id,target:<slot>,p,x,serverNow,blindUntil,splash:[{slot,until}]}`: el pato `target` queda ciego `DONUT_BLIND_S`=3 s (solo visual, sin stun); `splash` lista los demas patos a `hypot(dp,dx)<=DONUT_SPLASH_R`=10 de la trampa (ciegos 1.5 s hasta `until`); aire y gigantes no entran en `splash`. Luego `trapGone{id}`.
- Dura hasta ser activada o `DONUT_TTL_S`=60 s (`trapGone{id}`). Maximo `DONUT_MAX`=6 trampas simultaneas: la mas vieja desaparece (`trapGone`). Se limpian al volver al lobby.

## CANGRI (easter egg C-A-N-G-R-I)
- C->S `cangri{}` al completar la secuencia. Solo en `race` iniciada, no aturdido, no llegado a meta. **2 usos por jugador por carrera** (`CANGRI_PER_RACE`), **cooldown 15 s** (`CANGRI_COOLDOWN_S`). Rechazo por cooldown/sin usos/aturdido -> `cangriNo{usesLeft,cooldownUntil,serverNow}`; fuera de carrera, silencio.
- S->C `cangriState{usesLeft,cooldownUntil,serverNow}` al autor al iniciar la carrera y tras cada uso.
- S->C `cangri{from:<slot>,id,serverNow,flashMs:1500,usesLeft,cooldownUntil}` a todos: el cliente muestra la foto `flashMs` ms y sacude la camara. Ademas `stun` de `CANGRI_STUN_S`=1 s a todos los demas patos (jugadores y bots; no al autor), con la inmunidad post-stun, de aire y de gigante.
- `welcome.consts`: `CANGRI_PER_RACE=2, CANGRI_COOLDOWN_S=15, CANGRI_STUN_S=1`. Estaticos: `/cangri.webp` (`image/webp`) y `GET /sfx/cangri.mp3` (`audio/mpeg`, archivo local no versionado en `sfx/`; 404 si falta; solo ese archivo se sirve de `sfx/`).
