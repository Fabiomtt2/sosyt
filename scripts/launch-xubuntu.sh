#!/usr/bin/env bash
set -u

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="http://localhost:5173/"
API="http://localhost:3333/health"
LOG="$PROJECT/.local-tmp/dev-launcher.log"
PIDFILE="$PROJECT/.local-tmp/dev-launcher.pid"

mkdir -p "$PROJECT/.local-tmp"

web_ok() { curl -fsS --max-time 2 "$BASE_URL" >/dev/null 2>&1; }
api_ok() { curl -fsS --max-time 2 "$API" >/dev/null 2>&1; }

if ! web_ok || ! api_ok; then
  cd "$PROJECT" || exit 1
  nohup npm run dev >"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
fi

for _ in $(seq 1 60); do
  if web_ok && api_ok; then
    FRESH_URL="${BASE_URL}?dev=$(date +%s)"
    if command -v firefox >/dev/null 2>&1; then
      nohup firefox --new-window "$FRESH_URL" >/dev/null 2>&1 &
    else
      xdg-open "$FRESH_URL" >/dev/null 2>&1 &
    fi
    notify-send "YouTube Final" "Projeto aberto em http://localhost:5173/" 2>/dev/null || true
    exit 0
  fi
  sleep 1
done

notify-send "YouTube Final" "O servidor não respondeu em 60 segundos. Consulte $LOG" 2>/dev/null || true
exit 1
