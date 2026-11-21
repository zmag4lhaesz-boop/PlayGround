#!/usr/bin/env bash
# Once-per-worker prerequisites only. Build/serve work belongs in start.sh.
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd -P)"

timed() {
  local label="$1"; shift
  local start end rc
  start=$(date +%s%N)
  set +e
  "$@"
  rc=$?
  set -e
  end=$(date +%s%N)
  local elapsed_ns=$((end - start))
  printf '[timing] startup.sh %-24s %d.%03ds exit=%d\n' \
    "$label" "$((elapsed_ns / 1000000000))" "$(((elapsed_ns / 1000000) % 1000))" "$rc" >&2
  return "$rc"
}

timed "verify project dir" test -d "$PROJECT_DIR"
timed "node version" node --version

PLAYWRIGHT_DIR="${HOME}/.local/share/omgithub-playwright"
if [[ -d "$PLAYWRIGHT_DIR/node_modules/playwright" ]]; then
  echo "[startup] playwright runtime present"
else
  if [[ -n "${RUNTIME_DIR:-}" && -f "$RUNTIME_DIR/scripts/setup-linux-playwright.sh" ]]; then
    timed "install playwright" bash "$RUNTIME_DIR/scripts/setup-linux-playwright.sh"
  else
    echo '[startup] playwright runtime missing and no runtime setup script available' >&2
    exit 1
  fi
fi

echo "[startup] prerequisites ready"
