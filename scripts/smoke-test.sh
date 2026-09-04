#!/usr/bin/env bash
# End-to-end check of the NoteCraft API against a running server.
#
# Registers two users, shares a note between them, and asserts that the
# permission rules actually hold — including the ones that are easy to get
# wrong, like a viewer being able to react but not edit.
#
# Usage: ./scripts/smoke-test.sh   (server must be running on $API)
set -u

API="${API:-http://localhost:3001/api}"

# INSECURE=1 skips certificate verification, for testing a stack behind a
# locally-issued certificate. Never use it against the real deployment: it
# would make a man-in-the-middle indistinguishable from a passing test.
CURL_FLAGS=()
[ "${INSECURE:-}" = "1" ] && CURL_FLAGS+=(-k)
# Expanded as ${CURL_FLAGS[@]+"${CURL_FLAGS[@]}"} everywhere below: under
# `set -u`, expanding an empty array with the plain form is an error in the
# bash 3.2 that macOS ships.

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
check() { # check <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1))
  else
    printf '  \033[31m✗\033[0m %s — expected %s, got %s\n' "$1" "$3" "$2"; fail=$((fail+1))
  fi
}

# Unique emails so the script can be run repeatedly against the same database.
STAMP=$(date +%s)$RANDOM
OWNER="owner+$STAMP@test.local"
VIEWER="viewer+$STAMP@test.local"
PW="correct-horse-battery"

api() { # api <cookiejar> <method> <path> [json]
  local jar=$1 method=$2 path=$3 body=${4:-}
  if [ -n "$body" ]; then
    curl -s ${CURL_FLAGS[@]+"${CURL_FLAGS[@]}"} -o "$TMP/body" -w '%{http_code}' -b "$jar" -c "$jar" \
      -X "$method" "$API$path" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s ${CURL_FLAGS[@]+"${CURL_FLAGS[@]}"} -o "$TMP/body" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$API$path"
  fi
}
field() { node -e "try{console.log(JSON.parse(require('fs').readFileSync('$TMP/body','utf8'))$1)}catch(e){console.log('')}"; }

echo "Auth"
code=$(api "$TMP/owner" POST /auth/register "{\"email\":\"$OWNER\",\"password\":\"$PW\",\"name\":\"Ada Lovelace\"}")

# Each run registers two accounts, and /auth is capped at 20 attempts per 15
# minutes per IP. Running the suite repeatedly trips it — which looks like the
# entire API breaking, since every later assertion depends on being signed in.
if [ "$code" = "429" ]; then
  echo "  ! auth rate limit reached (20 attempts / 15 min per IP)."
  echo "    Wait for the window to roll, or raise the cap in server/src/routes/auth.js."
  exit 2
fi

check "owner registers" "$code" "201"
code=$(api "$TMP/viewer" POST /auth/register "{\"email\":\"$VIEWER\",\"password\":\"$PW\",\"name\":\"Grace Hopper\"}")
check "viewer registers" "$code" "201"
code=$(api "$TMP/anon" GET /notes)
check "unauthenticated request is rejected" "$code" "401"
code=$(api "$TMP/owner" POST /auth/register "{\"email\":\"$OWNER\",\"password\":\"$PW\",\"name\":\"Dup\"}")
check "duplicate email is rejected" "$code" "409"

echo
echo "Notes"
code=$(api "$TMP/owner" POST /notes '{"title":"Red-Black Trees","course":"CS 2110","tags":["Trees","  BALANCING ","trees"],"language":"cpp"}')
check "owner creates a note" "$code" "201"
NOTE=$(field .id)
check "tags are normalized and de-duplicated" "$(field '.tags.join(",")')" "trees,balancing"

code=$(api "$TMP/owner" POST /notes '{"title":"Bad","language":"cobol"}')
check "unknown language is rejected" "$code" "400"

code=$(api "$TMP/viewer" GET "/notes/$NOTE")
check "a stranger cannot read the note" "$code" "404"

echo
echo "Sharing"
code=$(api "$TMP/owner" POST "/notes/$NOTE/permissions" "{\"email\":\"$VIEWER\",\"role\":\"viewer\"}")
check "owner shares as viewer" "$code" "201"
code=$(api "$TMP/viewer" GET "/notes/$NOTE")
check "viewer can now read" "$code" "200"
check "viewer sees their role" "$(field .role)" "viewer"

code=$(api "$TMP/viewer" PATCH "/notes/$NOTE" '{"title":"Hijacked"}')
check "viewer cannot edit metadata" "$code" "403"
code=$(api "$TMP/viewer" DELETE "/notes/$NOTE")
check "viewer cannot delete" "$code" "404"
code=$(api "$TMP/viewer" GET "/notes/$NOTE/permissions")
check "viewer cannot see the collaborator list" "$code" "403"

code=$(api "$TMP/owner" POST "/notes/$NOTE/permissions" "{\"email\":\"$VIEWER\",\"role\":\"editor\"}")
check "owner promotes to editor" "$code" "201"
code=$(api "$TMP/viewer" PATCH "/notes/$NOTE" '{"title":"Red-Black Trees (rev)"}')
check "editor can now retitle" "$code" "200"
code=$(api "$TMP/viewer" PATCH "/notes/$NOTE" '{"is_public":true}')
check "editor still cannot change visibility" "$code" "403"

echo
echo "Reactions"
code=$(api "$TMP/viewer" POST "/notes/$NOTE/reactions" '{"emoji":"🔥"}')
check "collaborator reacts" "$code" "200"
check "reaction is active" "$(field .active)" "true"
check "count is 1" "$(field '.reactions[0].count')" "1"
code=$(api "$TMP/viewer" POST "/notes/$NOTE/reactions" '{"emoji":"🔥"}')
check "reacting again toggles off" "$(field .active)" "false"
check "no reactions remain" "$(field '.reactions.length')" "0"
code=$(api "$TMP/viewer" POST "/notes/$NOTE/reactions" '{"emoji":"💀"}')
check "emoji outside the palette is rejected" "$code" "400"

echo
echo "Search and filters"
api "$TMP/owner" GET "/notes?course=CS%202110" >/dev/null
check "course filter finds the note" "$(field .length)" "1"
api "$TMP/owner" GET "/notes?tag=balancing" >/dev/null
check "tag filter finds the note" "$(field .length)" "1"
api "$TMP/owner" GET "/notes?tag=nonexistent" >/dev/null
check "tag filter excludes non-matches" "$(field .length)" "0"
api "$TMP/owner" GET "/notes?q=red-black" >/dev/null
check "full-text search finds the note by title" "$(field .length)" "1"

echo
echo "Viewer activity"
# A view is recorded by *opening* a note, not by creating it, so the owner has
# not been recorded yet at this point.
api "$TMP/owner" GET "/notes/$NOTE/viewers" >/dev/null
check "viewer recorded after reading" "$(field .length)" "1"
api "$TMP/owner" GET "/notes/$NOTE" >/dev/null
api "$TMP/owner" GET "/notes/$NOTE/viewers" >/dev/null
check "owner recorded after opening" "$(field .length)" "2"

echo
echo "Profile"
code=$(api "$TMP/owner" PATCH /profile/me "{\"username\":\"ada$STAMP\",\"bio\":\"CS @ Cornell\",\"avatar_color\":\"emerald\",\"grad_year\":2027}")
check "profile updates" "$code" "200"
check "avatar colour saved" "$(field .avatar_color)" "emerald"
code=$(api "$TMP/owner" PATCH /profile/me '{"avatar_color":"neon"}')
check "unknown avatar colour rejected" "$code" "400"
code=$(api "$TMP/owner" PATCH /profile/me '{"username":"Not Valid!"}')
check "malformed username rejected" "$code" "400"
code=$(api "$TMP/viewer" PATCH /profile/me "{\"username\":\"ada$STAMP\"}")
check "duplicate username rejected" "$code" "409"
# One note was created successfully; the second creation was rejected as invalid.
api "$TMP/owner" GET /profile/me/stats >/dev/null
check "stats count owned notes" "$(field .notes_owned)" "1"
check "stats count collaborators" "$(field .collaborators)" "1"

echo
echo "Built-in compiler"
if ! curl -s ${CURL_FLAGS[@]+"${CURL_FLAGS[@]}"} --max-time 5 "$API/execute/languages" -b "$TMP/owner" >/dev/null 2>&1; then
  echo "  - skipped (execute endpoint unreachable)"
else
  api "$TMP/owner" GET /execute/languages >/dev/null
  check "language list is offered" "$(field .length)" "8"

  code=$(api "$TMP/owner" POST /execute '{"language":"python","source":"n=int(input())\nprint(sum(range(n+1)))","stdin":"100"}')
  check "python runs with stdin" "$code" "200"
  check "python produced the right answer" "$(field '.run.stdout.trim()')" "5050"
  check "python exited cleanly" "$(field .run.code)" "0"

  code=$(api "$TMP/owner" POST /execute '{"language":"cpp","source":"#include <iostream>\nint main(){std::cout<<6*7;}"}')
  check "c++ compiles and runs" "$(field '.run.stdout.trim()')" "42"

  api "$TMP/owner" POST /execute '{"language":"cpp","source":"int main(){ this is not c++ }"}' >/dev/null
  check "compile errors are reported separately" "$(node -e "const r=JSON.parse(require('fs').readFileSync('$TMP/body','utf8'));console.log(r.compile && r.compile.code!==0)")" "true"

  api "$TMP/owner" POST /execute '{"language":"python","source":"import sys\nprint(\"oops\", file=sys.stderr)\nsys.exit(3)"}' >/dev/null
  check "runtime stderr is captured" "$(field '.run.stderr.trim()')" "oops"
  check "non-zero exit code is surfaced" "$(field .run.code)" "3"

  code=$(api "$TMP/owner" POST /execute '{"language":"cobol","source":"x"}')
  check "unsupported language is rejected" "$code" "400"
  code=$(api "$TMP/owner" POST /execute '{"language":"python","source":"   "}')
  check "empty source is rejected" "$code" "400"
fi

echo
echo "Revoking access"
code=$(api "$TMP/owner" DELETE "/notes/$NOTE/permissions/$(api "$TMP/owner" GET "/notes/$NOTE/permissions" >/dev/null; field '[0].id')")
check "owner revokes access" "$code" "200"
code=$(api "$TMP/viewer" GET "/notes/$NOTE")
check "revoked user loses access" "$code" "404"

echo
printf '\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
