#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fixmyhome}"

cd "${APP_DIR}"

git fetch origin main
git reset --hard origin/main

docker compose build app migrate
docker compose run --rm migrate
docker compose up -d app
docker compose ps

curl --fail http://127.0.0.1:3000/api/health
echo
echo "Redeploy complete."
