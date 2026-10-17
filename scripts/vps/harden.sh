#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
source "$SCRIPT_DIR/common.sh"
if [[ ${1:-} == --help && $# == 1 ]]; then
  printf 'Usage: tailscale ssh derp-admin@<tail-address> '\''sudo bash /root/derp-setup/scripts/vps/harden.sh'\''\nFirst verify a separate native login with id -un and sudo -n true; retain provider console access.\n'
  exit 0
fi
(($# == 0)) || fail 'No arguments accepted.'
require_root
[[ ${SUDO_USER:-} == derp-admin ]] || fail 'Run through the separately verified derp-admin native Tailscale SSH sudo session.'
lock_host
require_managed
require_bun
[[ $(stat -c '%u:%a' /etc/sudoers.d/derp-admin) == 0:440 ]] || fail 'Unsafe administrator sudoers file.'
visudo -cf /etc/sudoers.d/derp-admin
require_tailnet
mask_ordinary_ssh
# ufw show added hides saved IPv6 tuples when IPV6 is disabled. Refuse them
# before turning IPv6 on; otherwise an old underlay SSH allow could reappear.
ipv6_enabled=false
while IFS= read -r line; do
  case "$line" in
    IPV6=yes|IPV6=\"yes\"|IPV6=\'yes\') ipv6_enabled=true;;
    IPV6=*) ipv6_enabled=false;;
  esac
done < /etc/default/ufw
if [[ $ipv6_enabled == false && -f /etc/ufw/user6.rules ]]; then
  while IFS= read -r line; do
    case "$line" in
      '### tuple ###'*|'-A ufw6-user-input '*|'-A ufw6-user-output '*|'-A ufw6-user-forward '*)
        fail 'Saved IPv6 UFW user rules exist while IPv6 is disabled; review/remove through the console before enabling.';;
    esac
  done < /etc/ufw/user6.rules
fi
added=$(ufw show added)
while IFS= read -r line; do
  case "$line" in
    "ufw allow 80/tcp comment 'derp-http'"|"ufw allow 443/tcp comment 'derp-https'") ;;
    ufw*) fail "Unmanaged UFW user rule; remove/review from console before proceeding: $line";;
  esac
done <<< "$added"
work=$(mktemp -d)
complete=false
restore_config() {
  local status=$?
  if [[ $complete != true ]]; then
    [[ ! -e $work/ufw.previous ]] || cp -a "$work/ufw.previous" /etc/default/ufw
    if [[ -e $work/upgrades.previous ]]; then
      cp -a "$work/upgrades.previous" /etc/apt/apt.conf.d/52derp-security-upgrades
    elif [[ -e $work/upgrades.installed ]]; then
      rm -f /etc/apt/apt.conf.d/52derp-security-upgrades
    fi
    printf 'dERP: managed config restored after failure; ordinary SSH remains masked. Inspect effective firewall through the console.\n' >&2
  fi
  rm -rf -- "$work"
  return "$status"
}
trap restore_config EXIT
backup_once /etc/default/ufw
cp -a /etc/default/ufw "$work/ufw.previous"
found_ipv6=false
while IFS= read -r line; do
  if [[ $line == IPV6=* ]]; then printf 'IPV6=yes\n'; found_ipv6=true; else printf '%s\n' "$line"; fi
done < /etc/default/ufw > "$work/ufw"
[[ $found_ipv6 == true ]] || printf 'IPV6=yes\n' >> "$work/ufw"
# Literal apt variable: shell expansion would silently choose the wrong origin.
cat > "$work/upgrades" <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "false";
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
APT
apt-config -c "$work/upgrades" dump >/dev/null
backup_once /etc/apt/apt.conf.d/52derp-security-upgrades
if [[ -e /etc/apt/apt.conf.d/52derp-security-upgrades ]]; then cp -a /etc/apt/apt.conf.d/52derp-security-upgrades "$work/upgrades.previous"; fi
install -o root -g root -m 0644 "$work/ufw" /etc/default/ufw
install -o root -g root -m 0644 "$work/upgrades" /etc/apt/apt.conf.d/52derp-security-upgrades
touch "$work/upgrades.installed"
unattended-upgrade --dry-run --debug
ufw default deny incoming
ufw default deny routed
ufw default allow outgoing
ufw allow 80/tcp comment 'derp-http'
ufw allow 443/tcp comment 'derp-https'
ufw --force enable
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
require_tailnet
complete=true
printf 'Ordinary SSH must remain persistently masked:\n'
systemctl is-enabled ssh.service ssh.socket || true
systemctl is-active ssh.service ssh.socket || true
tailscale status
tailscale netcheck
ufw status verbose
ufw show raw
printf 'Hardening activated. Verify another native derp-admin login/sudo and denied root/nonoperator/public IPv4+IPv6 SSH. UFW alone is not tailnet authorization proof.\n'
