#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANUAL_STATE_FILE="${XDG_RUNTIME_DIR:-/tmp}/kaiku-manual-podman-services"

detect_compose_subcommand() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      up | down | ps | logs)
        printf '%s\n' "$arg"
        return 0
        ;;
    esac
  done

  printf '\n'
}

subcommand_args() {
  local target="$1"
  shift

  local arg found="false"
  for arg in "$@"; do
    if [[ "$found" == "true" ]]; then
      printf '%s\n' "$arg"
    elif [[ "$arg" == "$target" ]]; then
      found="true"
    fi
  done
}

contains_arg() {
  local needle="$1"
  shift

  local arg
  for arg in "$@"; do
    if [[ "$arg" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

print_pasta_help() {
  cat >&2 <<'EOF'
Podman failed to create rootless networking with pasta.
This environment cannot open /dev/net/tun for container networking.

Use one of the following:
  1) Install and use Docker Compose.
  2) Configure Podman to use slirp4netns.
  3) Run in an environment where /dev/net/tun is usable.
EOF
}

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

if ! command -v podman-compose >/dev/null 2>&1; then
  echo "No supported compose runtime found. Install Docker Compose or podman-compose." >&2
  exit 1
fi

use_vfs="false"
vfs_mode="${KAIKU_PODMAN_VFS:-auto}"

if [[ "$vfs_mode" == "always" ]]; then
  use_vfs="true"
elif [[ "$vfs_mode" == "auto" ]]; then
  fs_type="$(stat -f -c %T "$HOME" 2>/dev/null || true)"
  if [[ "$fs_type" == "btrfs" ]]; then
    use_vfs="true"
  fi
fi

podman_global_args=()
podman_compose_args=()

if [[ "$use_vfs" == "true" ]]; then
  vfs_root="${KAIKU_PODMAN_VFS_ROOT:-$HOME/.local/share/containers/storage-vfs}"
  vfs_runroot="${KAIKU_PODMAN_VFS_RUNROOT:-/tmp/podman-run-vfs}"

  mkdir -p "$vfs_root" "$vfs_runroot"

  podman_global_args=(--storage-driver=vfs --root="$vfs_root" --runroot="$vfs_runroot")
  podman_compose_args=(--podman-args "--storage-driver=vfs --root=$vfs_root --runroot=$vfs_runroot")
fi

podman_cmd() {
  podman "${podman_global_args[@]}" "$@"
}

manual_services_present() {
  if podman_cmd container exists canis-dev-postgres >/dev/null 2>&1; then
    return 0
  fi

  if podman_cmd container exists canis-dev-valkey >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

manual_services_up() {
  podman_cmd rm -f canis-dev-postgres canis-dev-valkey >/dev/null 2>&1 || true

  podman_cmd run -d \
    --name canis-dev-postgres \
    --network host \
    --restart unless-stopped \
    -e POSTGRESQL_USERNAME=voicechat \
    -e POSTGRESQL_PASSWORD=voicechat_dev \
    -e POSTGRESQL_DATABASE=voicechat \
    -e POSTGRESQL_POSTGRES_PASSWORD=postgres_dev \
    -e POSTGRESQL_PORT_NUMBER=5433 \
    -e PGPORT=5433 \
    -v postgres_dev_data:/bitnami/postgresql \
    -v "$PROJECT_ROOT/infra/docker/init-scripts:/docker-entrypoint-initdb.d:ro" \
    docker.io/bitnami/postgresql:latest >/dev/null

  podman_cmd run -d \
    --name canis-dev-valkey \
    --network host \
    --restart unless-stopped \
    -e ALLOW_EMPTY_PASSWORD=yes \
    -v valkey_dev_data:/bitnami/valkey/data \
    docker.io/bitnami/valkey:latest >/dev/null

  local i
  for i in $(seq 1 60); do
    if podman_cmd exec canis-dev-postgres pg_isready -U voicechat -d voicechat -p 5433 >/dev/null 2>&1; then
      break
    fi

    if [[ "$i" -eq 60 ]]; then
      podman_cmd logs canis-dev-postgres >&2 || true
      echo "PostgreSQL did not become ready in manual fallback mode." >&2
      return 1
    fi

    sleep 1
  done

  for i in $(seq 1 60); do
    if podman_cmd exec canis-dev-valkey valkey-cli ping >/dev/null 2>&1; then
      break
    fi

    if [[ "$i" -eq 60 ]]; then
      podman_cmd logs canis-dev-valkey >&2 || true
      echo "Valkey did not become ready in manual fallback mode." >&2
      return 1
    fi

    sleep 1
  done

  touch "$MANUAL_STATE_FILE"
  echo "Started dev services using manual podman host-network fallback." >&2
  return 0
}

manual_services_down() {
  local remove_volumes="false"
  if contains_arg "-v" "$@" || contains_arg "--volumes" "$@"; then
    remove_volumes="true"
  fi

  podman_cmd rm -f canis-dev-postgres canis-dev-valkey >/dev/null 2>&1 || true

  if [[ "$remove_volumes" == "true" ]]; then
    podman_cmd volume rm -f postgres_dev_data valkey_dev_data >/dev/null 2>&1 || true
  fi

  rm -f "$MANUAL_STATE_FILE"
}

manual_services_ps() {
  podman_cmd ps -a --filter name=canis-dev-postgres --filter name=canis-dev-valkey "$@"
}

manual_services_logs() {
  if contains_arg "-f" "$@" || contains_arg "--follow" "$@"; then
    podman_cmd logs -f canis-dev-postgres &
    local pg_pid=$!
    podman_cmd logs -f canis-dev-valkey &
    local valkey_pid=$!

    trap 'kill "$pg_pid" "$valkey_pid" >/dev/null 2>&1 || true' INT TERM
    wait "$pg_pid" "$valkey_pid"
    return $?
  fi

  echo "== canis-dev-postgres =="
  podman_cmd logs canis-dev-postgres || true
  echo "== canis-dev-valkey =="
  podman_cmd logs canis-dev-valkey || true
}

run_podman_compose() {
  set +e
  PODMAN_COMPOSE_OUTPUT="$(podman-compose "${podman_compose_args[@]}" "$@" 2>&1)"
  PODMAN_COMPOSE_RC=$?
  set -e
}

is_pasta_failure() {
  local text="$1"
  [[ "$text" == *"setting up Pasta"* ]] || [[ "$text" == *"/dev/net/tun"* ]]
}

compose_subcommand="$(detect_compose_subcommand "$@")"
mapfile -t compose_sub_args < <(subcommand_args "$compose_subcommand" "$@")

if [[ ! -f "$MANUAL_STATE_FILE" ]] && manual_services_present; then
  touch "$MANUAL_STATE_FILE"
fi

if [[ -f "$MANUAL_STATE_FILE" ]]; then
  case "$compose_subcommand" in
    down)
      manual_services_down "${compose_sub_args[@]}"
      exit 0
      ;;
    ps)
      manual_services_ps "${compose_sub_args[@]}"
      exit 0
      ;;
    logs)
      manual_services_logs "${compose_sub_args[@]}"
      exit $?
      ;;
  esac
fi

if [[ "$compose_subcommand" == "up" ]] && [[ "${KAIKU_PODMAN_MANUAL_SERVICES:-auto}" == "always" ]]; then
  manual_services_up
  exit $?
fi

run_podman_compose "$@"

if [[ $PODMAN_COMPOSE_RC -eq 0 ]] && ! is_pasta_failure "$PODMAN_COMPOSE_OUTPUT"; then
  if [[ -n "$PODMAN_COMPOSE_OUTPUT" ]]; then
    printf '%s\n' "$PODMAN_COMPOSE_OUTPUT"
  fi

  if [[ "$compose_subcommand" == "up" ]]; then
    rm -f "$MANUAL_STATE_FILE"
  fi

  exit 0
fi

if [[ -n "$PODMAN_COMPOSE_OUTPUT" ]]; then
  printf '%s\n' "$PODMAN_COMPOSE_OUTPUT" >&2
fi

if is_pasta_failure "$PODMAN_COMPOSE_OUTPUT"; then
  if [[ "$compose_subcommand" == "up" ]]; then
    echo "Falling back to manual podman host-network services." >&2
    manual_services_up
    exit $?
  fi

  print_pasta_help
fi

exit "$PODMAN_COMPOSE_RC"
