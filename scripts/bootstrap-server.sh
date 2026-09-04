#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 host to run NoteCraft.
#
# Installs Docker, hardens the basics, and leaves the repo ready to start.
# Run once, as a user with sudo, on the new machine.
set -euo pipefail

REPO="${REPO:-https://github.com/laxmihatte/collab-editor.git}"
APP_DIR="${APP_DIR:-$HOME/notecraft}"

echo "==> System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git ufw fail2ban

echo "==> Docker"
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

echo "==> Firewall"
# Only SSH and the web ports. Postgres and the code sandbox are reachable only
# on Docker's internal network, and nothing publishes them — but a firewall
# means a future mistake in a compose file cannot quietly expose them either.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "==> Swap"
# Compiling C++ or Java in the sandbox can spike memory. On a 2 GB host, swap
# is the difference between a slow compile and the kernel killing Postgres.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo "==> Application"
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO" "$APP_DIR"
fi

cat <<NEXT

Bootstrap complete.

Next steps:
  1. Log out and back in so your user picks up the docker group.
  2. cd $APP_DIR
  3. cp .env.production.example .env.production and fill it in:
       DOMAIN=<your domain>
       POSTGRES_PASSWORD=\$(openssl rand -base64 36)
       JWT_SECRET=\$(openssl rand -base64 36)
  4. Point the domain's A record at this host's public IP, and wait for it
     to resolve — Caddy cannot get a certificate before that.
  5. ./scripts/deploy.sh

NEXT
