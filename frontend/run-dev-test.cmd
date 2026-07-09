@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
set "VITE_API_URL=http://127.0.0.1:8001"
set "VITE_WS_URL=ws://127.0.0.1:8001/ws"
cd /d "%~dp0"
call npm run dev -- --port 5174 --strictPort
