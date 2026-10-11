#!/usr/bin/env bash
# Internal helpers shared by the root entry points; never execute directly.
set -euo pipefail

fail() { printf 'dERP: %s\n' "$*" >&2; exit 1; }
require_root() { [[ $EUID == 0 ]] || fail 'Run as root (sudo for administration).'; }
require_console() {
  [[ -z ${SSH_CONNECTION:-} && -z ${SSH_CLIENT:-} && -z ${SSH_TTY:-} ]] || fail 'Provision/package maintenance requires the provider console, not SSH.'
  # sudo clears SSH_*; the kernel's ancestry still includes the SSH daemon.
  local pid=$BASHPID comm key parent
  while :; do
    if ! IFS= read -r comm < "/proc/$pid/comm" || [[ -z $comm ]]; then
      fail 'Cannot verify the provider console: unreadable process ancestry.'
    fi
    case "$comm" in
      sshd|sshd-session|tailscaled) fail 'Provision/package maintenance requires the provider console, not SSH.';;
    esac
    [[ $pid != 1 ]] || return 0
    parent=''
    while read -r key parent _; do
      if [[ $key == PPid: ]]; then break; fi
      parent=''
    done < "/proc/$pid/status" || fail 'Cannot verify the provider console: unreadable process ancestry.'
    [[ $parent =~ ^[1-9][0-9]*$ && $parent != "$pid" ]] || fail 'Cannot verify the provider console: incomplete process ancestry.'
    pid=$parent
  done
}
lock_host() {
  install -d -m 0755 /run/lock
  exec 9>/run/lock/derp-vps.lock
  flock -n 9 || fail 'Another dERP host operation is running.'
}
require_managed() {
  [[ -f /etc/derp/vps.conf && ! -L /etc/derp/vps.conf ]] || fail 'No managed installation.'
  [[ $(stat -c '%u:%a' /etc/derp/vps.conf) == 0:600 ]] || fail 'Unsafe managed configuration ownership/mode.'
  # Only this provisioner writes this root-only file, with validated literal values.
  source /etc/derp/vps.conf
  [[ ${DERP_HOSTNAME:-} && ${DERP_TAILSCALE_HOSTNAME:-} && ${DERP_BUN_VERSION:-} ]] || fail 'Incomplete managed configuration.'
}
backup_once() {
  local path=$1
  if [[ -e $path && ! -e $path.derp-original ]]; then cp -a -- "$path" "$path.derp-original"; fi
}
mask_ordinary_ssh() {
  local unit id state line listing instances listeners
  local -a units=(ssh.service ssh.socket)
  listing=$(systemctl list-unit-files --no-legend --no-pager)
  instances=$(systemctl list-units --all --full --no-legend --no-pager)
  while read -r unit _; do
    case "$unit" in sshd.service|sshd.socket|ssh@*.service|sshd@*.service|ssh-*.service|sshd-*.service|sshd-*.socket) units+=("$unit");; esac
  done <<< "$listing"$'\n'"$instances"
  for unit in "${units[@]}"; do
    # Bare templates have no runtime state; enumerated instances are stopped separately.
    if [[ $unit != *@.service ]]; then
      state=$(systemctl show "$unit" -p LoadState --value)
    else
      state=not-found
    fi
    if [[ $state != not-found ]]; then
      id=$(systemctl show "$unit" -p Id --value)
      systemctl stop "$unit"
      if [[ $state != masked ]]; then systemctl disable "${id:-$unit}"; fi
    fi
    # Persistent masks, including absent units, survive future package installation.
    systemctl mask "$unit"
    [[ $(readlink "/etc/systemd/system/$unit") == /dev/null ]] || fail "Missing persistent mask: $unit"
    if [[ $unit != *@.service ]] && systemctl is-active --quiet "$unit"; then fail "Ordinary SSH still active: $unit"; fi
  done
  listeners=$(ss -ltnp)
  while IFS= read -r line; do
    [[ $line != *'"sshd'* ]] || fail 'Unmanaged sshd listener remains; remove it through the provider console.'
  done <<< "$listeners"
}
require_tailnet() {
  systemctl is-active --quiet tailscaled.service || fail 'tailscaled is not active.'
  systemctl is-enabled --quiet tailscaled.service || fail 'tailscaled is not enabled.'
  tailscale status --json | /usr/local/bin/bun -e '
    const s=await new Response(Bun.stdin.stream()).json();
    if(s.BackendState!=="Running" || !s.Self?.Tags?.includes("tag:derp-vps")) process.exit(1);
  ' || fail 'Tailscale must be Running with tag:derp-vps; repair through the console.'
  [[ $(tailscale get ssh) == true ]] || fail 'Native Tailscale SSH is disabled.'
  [[ $(tailscale get netfilter-mode) == on ]] || fail 'Tailscale netfilter-mode must remain on.'
}
require_bun() {
  [[ -f /usr/local/bin/bun && ! -L /usr/local/bin/bun && $(stat -c '%u' /usr/local/bin/bun) == 0 ]] || fail 'Expected root-owned pinned Bun.'
  [[ $(/usr/local/bin/bun --version) == "$DERP_BUN_VERSION" ]] || fail 'Installed Bun differs from the managed pin.'
}
