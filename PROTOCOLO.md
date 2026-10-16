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
Constantes unicas en `server.js` (`C`), enviadas en `welcome.consts`: `LENGTH=520, HALF_W=11, MAX_SPEED=15, BOT_MAX=14.2, BOT_RUBBER=0.12, BOT_AVG=12.5, BOT_CAP=BOT_MAX*(1+BOT_RUBBER)+0.6`. El cliente debe usar estos valores.
- `state`: se valida con el reloj del servidor. `p` solo puede avanzar `MAX_SPEED*1.5*dt+1` por mensaje y nunca superar `MAX_SPEED*1.05*(tiempo desde startAt)+3`; retroceso max 10 u/s; `|x|<=HALF_W+0.5` y desplazamiento lateral <=30 u/s; `|vp|<=MAX_SPEED*1.1`, `|vx|<=30`. Lo que se recorta se recorta, no se rechaza el mensaje. Se ignora todo `state` antes de `startAt`. `fin` del cliente se ignora.
- `snap` lleva SIEMPRE la posicion saneada por el servidor (puede diferir de la tuya si fuiste recortado). El receptor no recibe su propia entrada; si el cliente quiere corregirse debe usar un `snap`/`state` propio futuro (no implementado: pide a Kenji si hace falta).
- `finish{time}`: el campo `time` se ignora. Vale solo si el `p` validado >= `LENGTH-2` y el tiempo de servidor desde `startAt` >= `LENGTH/MAX_SPEED` (34.7 s); si el `finish` llega antes, queda pendiente y se concede cuando el `p` validado alcance la meta. `finished.time` / `results.order[].time` = reloj de servidor en segundos.
- Bots: solo el host efectivo puede mandar `bots`/`botfinish`; cada bot se valida igual con `BOT_CAP`. `botfinish{slot}` vale solo si ese bot (validado) llego a meta. Si el host acumula >40 recortes de bots pierde el rol (`lobby.hostId` cambia en plena carrera: el nuevo host debe empezar a simular y mandar `bots`; el degradado deja de recibirlos de vuelta). Bots sin datos del host >600 ms los avanza el servidor en linea recta a `BOT_AVG` (si no hay otro host valido, el servidor los simula solos).
- `event`: `kind` /^[A-Za-z0-9_]{1,16}$/, 1 cada 150 ms, `data` saneado (profundidad 2, strings <=32 sin `<>&"'`` , numeros finitos, <=8 claves/items). Solo en carrera.
- Lobby: `nick`/`color`/`ready` siempre actuan sobre quien envia (no existe campo de destino; ids forjados se ignoran), solo en fase lobby, max 5 cambios/s por jugador.
- Limite honesto: un tramposo no puede ir mas rapido que un jugador legitimo al tope de velocidad, pero si puede ir siempre al tope (no hay verificacion de pulsaciones).
