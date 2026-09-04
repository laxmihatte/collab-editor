#!/usr/bin/env bash
# Installs the language runtimes the built-in compiler offers into a running
# Piston container. Idempotent: re-installing an existing package is a no-op.
#
# Note that Piston *packages* are not named after the languages they provide:
# `gcc` provides c and c++, `node` provides javascript. The names below are
# package names, taken from GET /api/v2/packages.
set -u
PISTON="${PISTON_HOST:-http://localhost:2000}"

packages=(
  "python 3.10.0"      # python
  "node 18.15.0"       # javascript
  "typescript 5.0.3"   # typescript
  "gcc 10.2.0"         # c and c++
  "java 15.0.2"        # java
  "go 1.16.2"          # go
  "rust 1.68.2"        # rust
)

failed=0
for entry in "${packages[@]}"; do
  set -- $entry
  printf '%-12s %-9s ... ' "$1" "$2"
  response=$(curl -s --max-time 1800 -X POST "$PISTON/api/v2/packages" \
    -H 'Content-Type: application/json' \
    -d "{\"language\":\"$1\",\"version\":\"$2\"}")

  if echo "$response" | grep -q '"language"'; then
    echo "installed"
  elif echo "$response" | grep -q 'Already installed'; then
    echo "already present"
  else
    echo "FAILED: $response"
    failed=1
  fi
done

echo
echo "Runtimes now available:"
curl -s "$PISTON/api/v2/runtimes" | tr ',' '\n' | grep -E '"language"|"version"' | paste - - | sed 's/"language"://;s/"version"://;s/"//g;s/^/  /'
exit $failed
