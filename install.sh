#!/bin/sh
# Installs Postdate: checks for Node.js, fetches what the app needs, then asks
# a few questions (language, where to run, where to keep the data).
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Postdate needs Node.js 22 or newer, which is not installed yet."
  echo "Get it from https://nodejs.org or your package manager, then run ./install.sh again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing what Postdate needs. This takes a minute..."
  npm install
fi

exec node scripts/setup.mjs "$@"
