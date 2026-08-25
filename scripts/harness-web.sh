#!/usr/bin/env sh
# Manage the locally built Harness Web profile without touching other services.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
state_dir="$project_root/.dsh-home"
pid_file="$state_dir/web-service.pid"
log_file="$state_dir/web-service.log"
port=${DSH_WEB_PORT:-3080}
start_timeout=${DSH_WEB_START_TIMEOUT:-15}

case "$start_timeout" in
  ''|*[!0-9]*) printf '%s\n' 'DSH_WEB_START_TIMEOUT must be a non-negative integer.' >&2; exit 2 ;;
esac

usage() {
  printf '%s\n' 'Usage: pnpm run web:service -- <start|stop|restart|status>'
  printf '%s\n' "Uses the already-built Web profile at http://127.0.0.1:$port."
  printf '%s\n' 'Set DSH_WEB_PORT to manage a different local port.'
  printf '%s\n' 'Set DSH_WEB_START_TIMEOUT to change the startup wait in seconds.'
}

read_pid() {
  [ -f "$pid_file" ] || return 1
  pid=$(tr -d '[:space:]' < "$pid_file")
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$pid"
}

owned_process() {
  process_pid=$1
  kill -0 "$process_pid" 2>/dev/null || return 1
  command=$(ps -p "$process_pid" -o command= 2>/dev/null || true)
  case "$command" in
    *'pnpm dsh web'*) return 0 ;;
    *) return 1 ;;
  esac
}

collect_process_tree() {
  process_pid=$1
  for child_pid in $(pgrep -P "$process_pid" 2>/dev/null || true); do
    collect_process_tree "$child_pid"
  done
  printf '%s\n' "$process_pid"
}

port_owner() {
  lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

wait_for_ready() {
  elapsed=0
  while [ "$elapsed" -lt "$start_timeout" ]; do
    if ! owned_process "$service_pid"; then return 1; fi
    if [ -n "$(port_owner)" ]; then return 0; fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

stop() {
  if ! service_pid=$(read_pid); then
    printf 'Harness Web is not managed by %s.\n' "$0"
    return 0
  fi
  if ! owned_process "$service_pid"; then
    printf 'Refusing to stop stale or foreign PID %s from %s.\n' "$service_pid" "$pid_file" >&2
    rm -f "$pid_file"
    return 0
  fi
  process_tree=$(collect_process_tree "$service_pid")
  for process_pid in $process_tree; do
    kill -TERM "$process_pid" 2>/dev/null || true
  done
  sleep 1
  for process_pid in $process_tree; do
    if kill -0 "$process_pid" 2>/dev/null; then kill -KILL "$process_pid" 2>/dev/null || true; fi
  done
  rm -f "$pid_file"
  if [ -n "$(port_owner)" ]; then
    printf 'Port %s is still occupied after stopping the managed process.\n' "$port" >&2
    return 1
  fi
  printf 'Harness Web stopped.\n'
}

start() {
  if service_pid=$(read_pid) && owned_process "$service_pid"; then
    printf 'Harness Web is already running (PID %s) at http://127.0.0.1:%s\n' "$service_pid" "$port"
    return 0
  fi
  rm -f "$pid_file"
  if occupied_pid=$(port_owner); [ -n "$occupied_pid" ]; then
    printf 'Port %s is occupied by PID %s; refusing to start.\n' "$port" "$occupied_pid" >&2
    return 1
  fi
  mkdir -p "$state_dir"
  (
    cd "$project_root"
    exec nohup pnpm dsh web --port "$port" </dev/null
  ) >> "$log_file" 2>&1 &
  service_pid=$!
  printf '%s\n' "$service_pid" > "$pid_file"
  if ! wait_for_ready; then
    printf 'Harness Web did not become ready. Inspect %s\n' "$log_file" >&2
    if owned_process "$service_pid"; then
      stop
    fi
    rm -f "$pid_file"
    return 1
  fi
  printf 'Harness Web started (PID %s) at http://127.0.0.1:%s\n' "$service_pid" "$port"
}

status() {
  if service_pid=$(read_pid) && owned_process "$service_pid"; then
    printf 'Harness Web is running (PID %s) at http://127.0.0.1:%s\n' "$service_pid" "$port"
    return 0
  fi
  if occupied_pid=$(port_owner); [ -n "$occupied_pid" ]; then
    printf 'Port %s is occupied by unmanaged PID %s.\n' "$port" "$occupied_pid"
    return 1
  fi
  printf 'Harness Web is stopped.\n'
}

[ "${1:-}" != '--' ] || shift

case ${1:-} in
  start) start ;;
  stop) stop ;;
  restart) stop && start ;;
  status) status ;;
  -h|--help|help|'') usage ;;
  *) usage >&2; exit 2 ;;
esac
