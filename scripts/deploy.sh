#!/usr/bin/env bash
# Builds and starts (or updates) the production stack.
# Safe to re-run: this is also the update path.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "Missing .env.production — copy .env.production.example and fill it in." >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

echo "==> Building"
$COMPOSE build

echo "==> Starting"
$COMPOSE up -d

echo "==> Waiting for the API"
for i in $(seq 1 60); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    API healthy after ${i}s"
    break
  fi
  sleep 1
done

echo "==> Installing language runtimes"
# Piston starts with no compilers. The packages live in a named volume, so this
# is a no-op on every deploy after the first. It runs inside the api container
# because that is the only service that can reach Piston — Piston publishes no
# ports, deliberately.
$COMPOSE exec -T -e PISTON_HOST=http://piston:2000 api node scripts/install-runtimes.js ||
  echo "    (runtime install reported problems — check with: $COMPOSE logs piston)"

echo "==> Running"
$COMPOSE ps
