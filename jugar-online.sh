#!/usr/bin/env sh
# Abre la carrera de patos del anfitrión en el navegador (no instala nada).
# Uso: sh jugar-online.sh https://xxxx.ngrok-free.dev
URL="${1:-https://giver-quiver-thirsty.ngrok-free.dev}"
URL="${URL%/}"; URL="${URL%/carrera.html}/carrera.html"
echo "Abriendo $URL"
echo "1) Pulsa 'Visit Site'  2) Usuario: patos + la clave que te pasaron  3) Nick, color y ¡Listo!"
for b in xdg-open google-chrome chromium firefox; do
  if command -v "$b" >/dev/null 2>&1; then "$b" "$URL" >/dev/null 2>&1 & exit 0; fi
done
echo "No encontré navegador: abre $URL a mano."
