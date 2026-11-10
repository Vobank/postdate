@echo off
rem Starts Postdate on this computer and opens it in the browser.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Postdate
node scripts\start.mjs %*
if errorlevel 1 pause
