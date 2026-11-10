#!/bin/sh
# Starts Postdate on this computer and opens it in the browser.
cd "$(dirname "$0")"
exec node scripts/start.mjs "$@"
