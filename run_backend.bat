@echo off
title NightAI Backend Server
echo ======================================================
echo           STARTING NIGHTAI BACKEND SERVER             
echo ======================================================
cd /d "%~dp0backend"
if not exist ".venv" (
    echo [ERROR] Virtual environment .venv not found.
    echo Please run backend setup first.
    pause
    exit /b
)
echo Activating virtual environment...
call .venv\Scripts\activate.bat
echo Starting FastAPI application...
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause
