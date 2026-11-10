@echo off
rem Installs Postdate: checks for Node.js, fetches what the app needs, then asks
rem a few questions (language, where to run, where to keep the data).
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist node_modules (
  echo Installing what Postdate needs. This takes a minute...
  call npm install
  if errorlevel 1 goto failed
)

node scripts\setup.mjs %*
if errorlevel 1 goto failed
goto end

:nonode
echo Postdate needs Node.js, which is not installed yet.
where winget >nul 2>nul
if errorlevel 1 (
  echo Download it from https://nodejs.org ^(the LTS version^), install it,
  echo then run install.cmd again.
) else (
  echo Installing Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js is installed. Close this window and run install.cmd again.
)
goto end

:failed
echo.
echo The installation did not finish. Fix the error shown above and run install.cmd again.

:end
echo.
pause
