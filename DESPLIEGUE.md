# Despliegue de Duckdowns

Guía para levantar el servidor multijugador y que tus amigos se conecten.

## Piezas

| Pieza | Qué es | Dónde corre |
|---|---|---|
| `server/server.js` | Servidor Node: sirve el juego (HTTP) y el lobby/carrera (WebSocket `/ws`) en el mismo puerto | PC del anfitrión |
| `carrera.html` | Cliente del juego (navegador) | Navegador de cada jugador |
| `jugar.sh` / `jugar.bat` | Abren el cliente local conectado a un servidor | PC de cada jugador (opcional) |
| `PROTOCOLO.md` | Contrato de mensajes cliente ↔ servidor | — |

Sin servidor (por ejemplo en GitHub Pages) el juego funciona **offline** contra bots.

## 1. Requisitos (solo el anfitrión)

- Node.js 18 o superior (`node --version`).
- Puerto libre (por defecto `8080`).

## 2. Levantar el servidor

```sh
cd server
npm install          # solo la primera vez (instala `ws`)
node server.js       # escucha en http://0.0.0.0:8080
```

Variables de entorno:

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP + WebSocket |
| `PUBLIC_URL` | — | Link público (túnel) que el lobby muestra primero para invitar |

Comprobar: abre `http://localhost:8080/carrera.html`. El lobby muestra los links para compartir.

Detener: `Ctrl+C`.

## 3. Cómo se conectan los amigos

### A) Misma red (casa / LAN)

Comparte el link `http://<tu-ip-local>:8080/carrera.html` que aparece en el lobby.
Si no conectan, abre el puerto en el firewall: `sudo ufw allow 8080/tcp` (ciérralo después con `sudo ufw delete allow 8080/tcp`).

### B) Por internet con ngrok (los amigos no instalan nada)

1. Cuenta gratis en <https://dashboard.ngrok.com> e instala ngrok:
   ```sh
   sudo snap install ngrok
   ngrok config add-authtoken <TU_TOKEN>   # nunca compartas ni subas el token
   ```
2. Abre el túnel **con contraseña** (mínimo 8 caracteres):
   ```sh
   ngrok http 8080 --basic-auth "patos:unaClaveLarga123"
   ```
3. En otra terminal, levanta el servidor con el link del túnel:
   ```sh
   cd server
   PUBLIC_URL=https://<subdominio>.ngrok-free.app/carrera.html node server.js
   ```
4. Pasa el link y la contraseña a tus amigos. Ellos aceptan la advertencia de ngrok, ingresan la clave y juegan.
5. Al terminar: `Ctrl+C` en ngrok y en el servidor.

> El link de ngrok es público: sin contraseña, cualquiera que lo tenga entra al juego y puede descargar los archivos servidos (incluido `musica.mp3`). Úsalo con `--basic-auth` y ciérralo al terminar.

### C) Por internet con Tailscale (más privado)

Comparte tu máquina desde el panel de Tailscale (*Share*). Tus amigos aceptan con su cuenta y entran a `http://<ip-tailscale>:8080/carrera.html`. No queda nada expuesto a internet, pero cada amigo necesita Tailscale.

## 4. Cliente portable (opcional)

Para jugar desde una copia local del juego (con tu propia música):

```sh
./jugar.sh https://<subdominio>.ngrok-free.app     # Linux / Mac
jugar.bat https://<subdominio>.ngrok-free.app      # Windows
./jugar.sh                                         # sin argumento = offline contra bots
```

- Acepta links `https://`, `http://` (LAN) o `ws(s)://`; arma solo la dirección `/ws`.
- Si el túnel usa contraseña, abre primero el link de ngrok en el mismo navegador e ingresa la clave; luego ejecuta el script.

## 5. Música

El juego reproduce `musica.mp3` si está junto a `carrera.html`. **No se incluye en el repo** (`.gitignore`): cada jugador pone su propia copia. Créditos de la canción sugerida en el `README.md`.

## 6. Reglas de la partida

- Lobby: cada jugador elige nick y color (únicos) y marca **Listo**.
- Con 2+ jugadores, la carrera arranca cuando todos están listos (cuenta de 4 s). Solo: arranca en ~1,5 s.
- Siempre corren 8 patos: los que faltan son bots.
- El servidor valida posiciones y llegadas; un cliente modificado no puede alterar la carrera de los demás.
- Llegan 3 al podio; al resto le cae un meteorito. Tras los resultados, todos vuelven al lobby.

## 7. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| "Sin servidor: juegas contra bots" | Servidor caído o link incorrecto | Revisa que `node server.js` siga corriendo y el link |
| Amigos en LAN no conectan | Firewall | `sudo ufw allow 8080/tcp` |
| `EADDRINUSE` al arrancar | Puerto ocupado | `PORT=8081 node server.js` (y usa ese puerto en ngrok) |
| No suena la música | Falta `musica.mp3` o el navegador bloqueó el audio | Pon el archivo junto a `carrera.html` y haz click en la página |
| El túnel pide clave en cada recarga | Comportamiento de ngrok | Normal; ingresa la clave |
