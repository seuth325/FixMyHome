#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fixmyhome}"
REPO_URL="${REPO_URL:-https://github.com/seuth325/FixMyHome.git}"
DOMAIN="${DOMAIN:-fixmyhome.pro}"
WWW_DOMAIN="${WWW_DOMAIN:-www.fixmyhome.pro}"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your regular SSH user, not root."
  exit 1
fi

echo "Installing base packages..."
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx ca-certificates curl

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine first, then rerun this script."
  echo "Guide: https://docs.docker.com/engine/install/"
  exit 1
fi

echo "Preparing ${APP_DIR}..."
sudo mkdir -p "${APP_DIR}"
sudo chown -R "${USER}:${USER}" "${APP_DIR}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin main
  git -C "${APP_DIR}" reset --hard origin/main
fi

cd "${APP_DIR}"

if [[ ! -f .env ]]; then
  cp deploy/production.env.example .env
  echo "Created ${APP_DIR}/.env from the production template."
  echo "Edit it now with real secrets, database values, and Uploadthing keys:"
  echo "  nano ${APP_DIR}/.env"
  exit 0
fi

echo "Starting database and app..."
docker compose up -d --build db
docker compose run --rm migrate
docker compose up -d --build app

echo "Installing Nginx site..."
sudo cp deploy/nginx/fixmyhome.conf /etc/nginx/sites-available/fixmyhome
if [[ ! -L /etc/nginx/sites-enabled/fixmyhome ]]; then
  sudo ln -s /etc/nginx/sites-available/fixmyhome /etc/nginx/sites-enabled/fixmyhome
fi
sudo nginx -t
sudo systemctl reload nginx

echo "Requesting TLS certificate..."
sudo certbot --nginx -d "${DOMAIN}" -d "${WWW_DOMAIN}"

echo "Checking health endpoint..."
curl --fail http://127.0.0.1:3000/api/health
echo
echo "FixMyHome is ready at https://${DOMAIN}"
