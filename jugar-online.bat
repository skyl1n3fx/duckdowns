@echo off
rem Abre la carrera de patos del anfitrion en el navegador (no instala nada).
rem Uso: jugar-online.bat https://xxxx.ngrok-free.dev   (o doble clic para el link por defecto)
setlocal
set "URL=%~1"
if "%URL%"=="" set "URL=https://giver-quiver-thirsty.ngrok-free.dev"
call set "URL=%%URL:/carrera.html=%%"
if "%URL:~-1%"=="/" set "URL=%URL:~0,-1%"
set "URL=%URL%/carrera.html"
echo Abriendo %URL%
echo 1) Pulsa "Visit Site"  2) Usuario: patos + la clave que te pasaron  3) Nick, color y Listo
start "" "%URL%"
