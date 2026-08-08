@echo off
title NightAI Mobile App
echo ======================================================
echo             STARTING NIGHTAI MOBILE APP               
echo ======================================================
cd /d "%~dp0mobile"
if not exist "node_modules" (
    echo [ERROR] node_modules not found. Running npm install...
    call npm install
)
echo Starting Expo Metro bundler...
npm start
pause
