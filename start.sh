#!/usr/bin/env bash
# Build the single-file game into dist/ and serve it in the foreground.
# The controller starts this inside the app-server tmux session.
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd -P)"
PORT="${PORT:-3000}"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
DIST="$PROJECT_DIR/dist"
export PROJECT_DIR PORT WEB_DIR DIST

# Per-command timing: print a stable, greppable line after each command.
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
  printf '[timing] start.sh %-24s %d.%03ds exit=%d\n' \
    "$label" "$((elapsed_ns / 1000000000))" "$(((elapsed_ns / 1000000) % 1000))" "$rc" >&2
  return "$rc"
}

printf '[start] project=%s\n' "$PROJECT_DIR"
printf '[start] port=%s\n' "$PORT"

timed "prepare dirs" mkdir -p "$DIST" "$WEB_DIR"

if [[ -f package.json ]]; then
  if [[ -f package-lock.json ]]; then
    timed "install dependencies" npm ci --no-audit --no-fund
  else
    timed "install dependencies" npm install --no-audit --no-fund
  fi
else
  echo '[start] no package.json; static single-file build needs no dependencies'
fi

if [[ -f build.mjs ]]; then
  timed "build" node build.mjs
elif [[ -f index.html ]]; then
  echo '[start] no build.mjs; using the existing index.html'
  timed "copy index.html" cp index.html "$DIST/index.html"
else
  echo '[start] no build entry point (expected build.mjs or index.html)' >&2
  exit 1
fi

if [[ ! -s "$DIST/index.html" ]]; then
  echo "[start] build output missing: $DIST/index.html" >&2
  exit 1
fi

# Publish the deployment manifest for the controller. The static directory must
# stay inside PROJECT_DIR; worker metadata lives in OPENCODE_WEB_DIR.
timed "deployment manifest" node -e '
const fs = require("node:fs");
const path = require("node:path");
const project = path.resolve(process.env.PROJECT_DIR);
const directory = path.resolve(process.env.DIST);
if (!directory.startsWith(project + path.sep)) {
  throw new Error("deployment directory must be inside the project");
}
if (!fs.existsSync(path.join(directory, "index.html"))) {
  throw new Error("deployment directory has no index.html");
}
const manifest = { project, directory };
fs.writeFileSync(
  path.join(process.env.WEB_DIR, "deployment-output.json"),
  JSON.stringify(manifest)
);
console.log("[start] deployment-output.json:", JSON.stringify(manifest));
'

printf '[start] serving %s on http://0.0.0.0:%s\n' "$DIST" "$PORT"
# Foreground server; timing prints when the session is stopped.
timed "serve" node scripts/serve.mjs
