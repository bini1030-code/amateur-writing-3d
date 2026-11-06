@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ^(18+^) is required: https://nodejs.org/
  pause
  exit /b 1
)
start "Writing Room Server" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
echo Your server is open in a second terminal. Close it to stop the room.
exit /b 0
