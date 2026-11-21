#!/usr/bin/env bash
# Capture the deployed preview at desktop and mobile sizes.
# Exit codes: 0 success, 75 temporary navigation/browser infrastructure failure,
# 1 script or rendering defect.
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd -P)"
PORT="${PORT:-3000}"
CAPTURE_URL="${CAPTURE_URL:-http://127.0.0.1:$PORT/}"
CAPTURE_DIR="${CAPTURE_DIR:-${RUNNER_TEMP:-/tmp}/reality-forge-capture-$(date +%s)}"
export PROJECT_DIR PORT CAPTURE_URL CAPTURE_DIR

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
  printf '[timing] capture.sh %-24s %d.%03ds exit=%d\n' \
    "$label" "$((elapsed_ns / 1000000000))" "$(((elapsed_ns / 1000000) % 1000))" "$rc" >&2
  return "$rc"
}

printf '[capture] url=%s\n' "$CAPTURE_URL"
printf '[capture] dir=%s\n' "$CAPTURE_DIR"

timed "prepare output dir" mkdir -p "$CAPTURE_DIR"

# Probe first so an unreachable preview is classified as transient instead of a
# capture-script defect. 4xx responses are real rendering/routing defects.
probe_code="$(curl --silent --show-error --location --max-time 20 \
  --output /dev/null --write-out '%{http_code}' "$CAPTURE_URL" 2>/dev/null || true)"
probe_code="$(printf '%s\n' "$probe_code" | tail -n1)"
probe_code="${probe_code:-000}"
printf '[capture] probe HTTP %s\n' "$probe_code"
case "$probe_code" in
  2*) : ;;
  000|408|429|5*)
    echo "[capture] preview temporarily unavailable (HTTP $probe_code); retry later" >&2
    exit 75
    ;;
  *)
    echo "[capture] preview rejected the request (HTTP $probe_code)" >&2
    exit 1
    ;;
esac

set +e
timed "run capture" node scripts/capture.mjs
rc=$?
set -e

for name in final-desktop.png final-mobile.png; do
  if [[ ! -s "$CAPTURE_DIR/$name" ]]; then
    echo "[capture] missing output: $CAPTURE_DIR/$name" >&2
    exit 1
  fi
done

timed "list output" ls -lh "$CAPTURE_DIR/final-desktop.png" "$CAPTURE_DIR/final-mobile.png"
printf '[capture] done: %s\n' "$CAPTURE_DIR"
exit "$rc"
