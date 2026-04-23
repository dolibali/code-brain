#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to develop BrainCode." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to develop BrainCode." >&2
  exit 1
fi

echo "==> Installing dependencies"
npm install

echo "==> Running typecheck"
npm run typecheck

echo
echo "BrainCode bootstrap complete."
echo "Useful commands:"
echo "  npm run doctor"
echo "  npm run cli -- --help"
echo "  npm run test"
echo "  npm run dev -- --help"

