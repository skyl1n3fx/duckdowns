@echo off
rem Abre el juego local conectado a un servidor de Duckdowns.
rem Uso: jugar.bat https://xxxx.ngrok-free.app   (o http://192.168.1.9:8080, o vacio = offline)
rem Musica: deja tu propia copia como musica.mp3 junto a carrera.html.
setlocal
cd /d "%~dp0"
set "URL=%~1"
set "WS="
if not "%URL%"=="" (
  set "WS=%URL%"
  call set "WS=%%WS:https://=wss://%%"
  call set "WS=%%WS:http://=ws://%%"
  call set "WS=%%WS:/carrera.html=%%"
)
if not "%WS%"=="" (
  if not "%WS:~0,2%"=="ws" set "WS=wss://%WS%"
  if "%WS:~-1%"=="/" set "WS=%WS:~0,-1%"
)
if not "%WS%"=="" if not "%WS:~-3%"=="/ws" set "WS=%WS%/ws"
if not exist musica.mp3 echo Aviso: no hay musica.mp3 aqui; el juego sonara solo con los chillidos.
set "DEST=carrera.html"
if not "%WS%"=="" set "DEST=carrera.html?server=%WS%"
> jugar_local.html echo ^<!doctype html^>^<meta charset="utf-8"^>^<script^>location.replace("%DEST%")^</script^>
echo Abriendo: %DEST%
start "" "jugar_local.html"
