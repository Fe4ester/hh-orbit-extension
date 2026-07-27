#!/bin/sh
set -eu

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="${HH_CDP_PROFILE_DIR:-$HOME/.hh-orbit-cdp-profile}"
PORT="${HH_CDP_PORT:-9222}"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome was not found at $CHROME" >&2
  exit 1
fi

exec "$CHROME" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://hh.ru/"
