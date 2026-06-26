#!/usr/bin/env bash
#
# Super D — deploy script.
# Guarantees every release does: pull -> install exact locked deps -> build -> restart.
# The "install" step is the one that was getting skipped, which broke CFR Money Trace
# (the newer code imports exceljs, but stale node_modules didn't have it).
#
# Usage on the server:
#   bash scripts/deploy.sh
#
# Tunables (env vars):
#   NO_PULL=1        skip `git pull` (set this if your platform already checks out the code)
#   RESTART_CMD=...  exact restart command; overrides auto-detection
#                    e.g. RESTART_CMD='pm2 restart super-d' bash scripts/deploy.sh
#
set -euo pipefail

# Always operate from the repo root, regardless of where this is invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "==> Deploying Super D from: $ROOT"

# 1. Latest code (skip if the deploy platform already pulled).
if [[ "${NO_PULL:-0}" != "1" ]]; then
  echo "==> git pull --ff-only"
  git pull --ff-only
fi

# 2. Install EXACT locked dependencies. `npm ci` wipes node_modules and installs
#    strictly from package-lock.json — no drift, nothing carried over from an old commit.
echo "==> npm ci"
npm ci

# 3. Build against the freshly-installed deps. Fails loudly if anything is missing.
echo "==> npm run build"
npm run build

# 4. Restart. Prefer an explicit RESTART_CMD; otherwise try to auto-detect.
echo "==> restart"
if [[ -n "${RESTART_CMD:-}" ]]; then
  eval "$RESTART_CMD"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe super-d >/dev/null 2>&1; then
  pm2 restart super-d --update-env
elif systemctl list-units --type=service --all 2>/dev/null | grep -q 'super-d'; then
  sudo systemctl restart super-d
else
  echo "!! Could not detect how to restart the app."
  echo "!! Re-run with an explicit command, e.g.:"
  echo "!!   RESTART_CMD='pm2 restart super-d' bash scripts/deploy.sh"
  exit 1
fi

echo "==> Done."
