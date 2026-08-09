#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CD_DIR="$SCRIPT_DIR/backend"

echo "======================================================"
echo "          STARTING NIGHTAI BACKEND SERVER             "
echo "======================================================"

cd "$CD_DIR"

if [ ! -d ".venv" ]; then
    echo "[ERROR] Virtual environment .venv not found in backend directory."
    echo "Please create a virtual environment first:"
    echo "  cd backend"
    echo "  python3 -m venv .venv"
    echo "  source .venv/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
fi

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Starting FastAPI application..."
exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
