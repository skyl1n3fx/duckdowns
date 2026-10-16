#!/usr/bin/env sh
# Abre el juego local conectado a un servidor de Duckdowns.
# Uso: ./jugar.sh https://xxxx.ngrok-free.app   (o http://192.168.1.9:8080, o vacío = offline)
# Música: deja tu propia copia como musica.mp3 junto a carrera.html.
set -e
cd "$(dirname "$0")"
URL="$1"
case "$URL" in
  "") WS="" ;;
  https://*) WS="wss://${URL#https://}" ;;
  http://*)  WS="ws://${URL#http://}" ;;
  ws://*|wss://*) WS="$URL" ;;
  *) WS="wss://$URL" ;;
esac
if [ -n "$WS" ]; then
  WS="${WS%/carrera.html}"; WS="${WS%/}"
  case "$WS" in */ws) ;; *) WS="$WS/ws" ;; esac
fi
[ -f musica.mp3 ] || echo "Aviso: no hay musica.mp3 aquí; el juego sonará solo con los chillidos."
if [ -n "$WS" ]; then DEST="carrera.html?server=$WS"; else DEST="carrera.html"; fi
printf '<!doctype html><meta charset="utf-8"><script>location.replace(%s)</script>\n' "\"$DEST\"" > jugar_local.html
echo "Abriendo: $DEST"
if command -v xdg-open >/dev/null 2>&1; then xdg-open jugar_local.html >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open jugar_local.html
else echo "Abre jugar_local.html en tu navegador."; fi
