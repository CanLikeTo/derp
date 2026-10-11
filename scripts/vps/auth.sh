#!/usr/bin/env bash
set -euo pipefail

# An empty Caddy import is valid syntax but removes authentication entirely.
# Accept only the exact managed realm/user/hash block, never an empty import.
valid_basic_auth_file() {
  local -a lines
  [[ -f $1 && ! -L $1 ]] || return 1
  mapfile -t lines < "$1" || return 1
  [[ ${#lines[@]} == 3 &&
     ${lines[0]} == 'basicauth bcrypt "dERP remote test" {' &&
     ${lines[1]} =~ ^'  tester '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ &&
     ${lines[2]} == '}' ]]
}

# Source this function under provision.sh's existing lock; standalone takes its own.
set_basic_auth() {
  local work hash had_previous=false
  [[ $EUID == 0 && -t 0 && -r /dev/tty && -w /dev/tty ]] || { printf 'dERP: root and a controlling TTY are required for hidden password entry.\n' >&2; return 1; }
  [[ -d /etc/caddy && -f /etc/caddy/Caddyfile && ! -L /etc/caddy/derp-users.caddy ]] || { printf 'dERP: expected managed Caddy configuration.\n' >&2; return 1; }
  printf 'Use a password-manager-generated tester password (at least 20 characters).\n' >&2
  hash=$(caddy hash-password --algorithm bcrypt </dev/tty) || return 1
  [[ $hash =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]] || { printf 'dERP: Caddy did not return a bcrypt hash.\n' >&2; return 1; }
  work=$(mktemp -d /etc/caddy/.derp-auth.XXXXXX) || return 1
  if [[ -e /etc/caddy/derp-users.caddy ]]; then
    cp -a /etc/caddy/derp-users.caddy "$work/previous" || { rm -rf -- "$work"; return 1; }
    had_previous=true
  fi
  if ! printf 'basicauth bcrypt "dERP remote test" {\n  tester %s\n}\n' "$hash" > "$work/users"; then
    unset hash
    rm -rf -- "$work"
    return 1
  fi
  unset hash
  if ! valid_basic_auth_file "$work/users"; then rm -rf -- "$work"; return 1; fi
  if ! chown root:caddy "$work/users" || ! chmod 0640 "$work/users" || ! mv -T "$work/users" /etc/caddy/derp-users.caddy; then rm -rf -- "$work"; return 1; fi
  if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile ||
     { systemctl is-active --quiet caddy.service && ! systemctl reload caddy.service; }; then
    if [[ $had_previous == true ]]; then
      mv -T "$work/previous" /etc/caddy/derp-users.caddy
    else
      rm -f /etc/caddy/derp-users.caddy
    fi
    rm -rf -- "$work"
    printf 'dERP: authentication activation failed; previous users file restored.\n' >&2
    return 1
  fi
  rm -rf -- "$work"
  printf 'Tester authentication installed; share the password privately, HTTPS only.\n'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
  source "$SCRIPT_DIR/common.sh"
  if [[ ${1:-} == --help && $# == 1 ]]; then printf 'Usage: sudo bash %s\nRotate the fixed tester Basic-auth password using a hidden TTY prompt.\n' "$0"; exit 0; fi
  (($# == 0)) || fail 'No arguments accepted (passwords never go in command arguments).'
  require_root
  lock_host
  require_managed
  set_basic_auth
fi
