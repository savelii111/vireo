#!/usr/bin/env bash
# Vireo dev runner — starts all services in background, logs to /tmp/vireo-*.log
# Usage: ./scripts/dev.sh [start|stop|status|logs]

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="${VIREO_LOGDIR:-/tmp}"

start_one() {
  local name=$1
  local cmd=$2
  local logfile="$LOGDIR/vireo-$name.log"
  echo "▶ $name → $logfile"
  (cd "$ROOT" && $cmd > "$logfile" 2>&1) &
  echo $! > "$LOGDIR/vireo-$name.pid"
}

stop_one() {
  local name=$1
  local pidfile="$LOGDIR/vireo-$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "■ $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
}

case "${1:-start}" in
  start)
    start_one style-learner    "python -m vireo_style_learner.server"
    start_one editor           "python -m vireo_editor.server"
    start_one distributor      "node agents/distributor/src/server.js"
    start_one analyst          "node agents/analyst/src/server.js"
    start_one auth             "node agents/auth/src/server.js"
    start_one billing          "node agents/billing/src/server.js"
    start_one dashboard        "node apps/dashboard/server.js"
    echo
    echo "Vireo running. Dashboard: http://localhost:3000"
    echo "Stop with: ./scripts/dev.sh stop"
    ;;
  stop)
    stop_one dashboard
    stop_one billing
    stop_one auth
    stop_one analyst
    stop_one distributor
    stop_one editor
    stop_one style-learner
    echo "All stopped."
    ;;
  status)
    for n in style-learner editor distributor analyst auth billing dashboard; do
      pidfile="$LOGDIR/vireo-$n.pid"
      if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
        echo "● $n (pid $(cat "$pidfile"))"
      else
        echo "○ $n (stopped)"
      fi
    done
    ;;
  logs)
    tail -f "$LOGDIR"/vireo-*.log
    ;;
  *)
    echo "Usage: $0 [start|stop|status|logs]"
    exit 1
    ;;
esac
