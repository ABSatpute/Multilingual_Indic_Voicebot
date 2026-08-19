#!/usr/bin/env bash
# One-shot deploy script for the Multilingual Indic Voicebot on an Ubuntu server
# (EC2 t3.micro/t4g.micro, Lightsail, or any Ubuntu 22.04 box).
#
# Usage:
#   sudo bash deploy.sh                                  # use GitHub (public repo)
#   sudo GITHUB_TOKEN=ghp_xxx bash deploy.sh             # use GitHub (private repo)
#   sudo SOURCE_DIR=/path/to/local/copy bash deploy.sh   # use a local copy (no GitHub)
#
# GITHUB_TOKEN is only required if the repository is private. It is read from
# the environment (never stored in this file) and stored in the instance's git
# credential helper so later "git pull" runs keep working.
#
# SOURCE_DIR: if set, the script copies the project from a local directory
# instead of cloning from GitHub (useful when you already have the repo locally).
# Example: scp -r backend infra\oracle\deploy.sh ubuntu@<ec2-ip>:~  then run with
# SOURCE_DIR=/home/ubuntu.
#
# After the script finishes:
#   sudo systemctl status voicebot
#   curl http://localhost:3000/health
set -euo pipefail

APP_DIR="/opt/voicebot"
REPO_URL="https://github.com/ABSatpute/Multilingual_Indic_Voicebot.git"
SERVICE_FILE="/etc/systemd/system/voicebot.service"
NODE_MAJOR="22"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy.sh"
  exit 1
fi

echo "==> Installing base packages (curl, git, ca-certificates, rsync)..."
apt-get update -qq
apt-get install -y -qq curl git ca-certificates rsync

echo "==> Installing Node.js ${NODE_MAJOR}..."
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
apt-get install -y -qq nodejs
node --version
npm --version

if [[ -n "${SOURCE_DIR:-}" ]]; then
  echo "==> Copying repository from local source: ${SOURCE_DIR}"
  mkdir -p "${APP_DIR}"
  rsync -a --exclude 'node_modules' --exclude 'dist' --exclude '.env' --exclude '.git' "${SOURCE_DIR}/" "${APP_DIR}/"
elif [[ ! -d "${APP_DIR}" ]]; then
  echo "==> Cloning repository into ${APP_DIR}..."
  mkdir -p "${APP_DIR}"
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/ABSatpute/Multilingual_Indic_Voicebot.git" "${APP_DIR}"
    git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"
    git -C "${APP_DIR}" config credential.helper "store --file ${APP_DIR}/.git-credentials"
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > "${APP_DIR}/.git-credentials"
    chmod 600 "${APP_DIR}/.git-credentials"
  else
    git clone "${REPO_URL}" "${APP_DIR}"
  fi
elif [[ -d "${APP_DIR}/.git" ]]; then
  echo "==> Repository exists, pulling latest..."
  git -C "${APP_DIR}" pull --rebase
else
  echo "==> ${APP_DIR} already contains the project, leaving it unchanged."
fi

echo "==> Installing backend dependencies and compiling TypeScript..."
cd "${APP_DIR}/backend"
npm install --no-fund --no-audit
npm run build

echo "==> Configuring environment file..."
ENV_FILE="${APP_DIR}/backend/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${APP_DIR}/.env.example" "${ENV_FILE}"
  echo "NOTE: Created ${ENV_FILE} from template."
  echo "      EDIT IT NOW with your real values, then restart the service:"
  echo "        sudo nano ${ENV_FILE}"
  echo "        sudo systemctl restart voicebot"
else
  echo "      ${ENV_FILE} already exists, leaving it unchanged."
fi

echo "==> Installing systemd service..."
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Multilingual Indic Voicebot (Express + Socket.io)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${APP_DIR}/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable voicebot
systemctl restart voicebot

echo ""
echo "==> Done. Service status:"
systemctl --no-pager status voicebot || true
echo ""
echo "Health check:"
curl -s http://localhost:3000/health || echo "(server still starting, retry in a few seconds)"
echo ""
echo "Next steps:"
echo "  1. Verify .env has SARVAM_API_KEY, KB_KNOWLEDGE_BASE_ID, KB_MODEL_ARN."
echo "  2. For HTTPS (required for mic in browser):"
echo "       sudo apt install -y cloudflared"
echo "       cloudflared tunnel --url http://localhost:3000"
echo "     Use the printed https://*.trycloudflare.com URL."