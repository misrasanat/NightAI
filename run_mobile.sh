#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CD_DIR="$SCRIPT_DIR/mobile"

echo "======================================================"
echo "            STARTING NIGHTAI MOBILE APP               "
echo "======================================================"

cd "$CD_DIR"

if [ ! -d "node_modules" ]; then
    echo "[ERROR] node_modules not found. Running npm install..."
    npm install
fi

echo "Starting Expo Metro bundler..."
npm start
