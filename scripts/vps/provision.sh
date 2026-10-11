#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(readlink -f -- "$SCRIPT_DIR/../..")
source "$SCRIPT_DIR/common.sh"
usage() {
  printf 'Usage: %s --hostname playtest.example.com --tailscale-hostname derp-vps\nRun only through the provider serial/VNC console; deny underlay SSH before boot.\n' "$0"
}
hostname='' tailname=''
while (($#)); do
  case "$1" in
    --hostname|--tailscale-hostname)
      (($# >= 2)) || fail "Missing value for $1"
      if [[ $1 == --hostname ]]; then hostname=$2; else tailname=$2; fi
      shift 2;;
    --help) usage; exit 0;;
    *) usage >&2; fail "Unknown argument: $1";;
  esac
done
valid_label() { [[ ${#1} -le 63 && $1 =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; }
[[ ${#hostname} -le 253 && $hostname == *.* && $hostname != *[!a-z0-9.-]* && $hostname != *. && $hostname != .* ]] || fail 'Invalid public DNS hostname.'
[[ ! $hostname =~ ^[0-9.]+$ ]] || fail 'Use a public DNS hostname, not an IP address.'
IFS=. read -r -a labels <<< "$hostname"
for label in "${labels[@]}"; do valid_label "$label" || fail 'Invalid public DNS label.'; done
valid_label "$tailname" || fail 'Invalid single-label Tailscale hostname.'
require_root
[[ -z ${SSH_CONNECTION:-} && -z ${SSH_CLIENT:-} ]] || fail 'Provision/package maintenance requires the provider console, not SSH.'
source /etc/os-release
[[ $ID == debian && $VERSION_ID == 13 ]] || fail 'Only Debian 13 is supported.'
[[ -d /run/systemd/system ]] || fail 'A running systemd host is required.'
[[ -c /dev/net/tun ]] || fail '/dev/net/tun is required.'
if ! (exec 8<>/dev/net/tun); then fail 'Cannot open /dev/net/tun.'; fi
for command in flock ss curl dpkg unzip systemctl; do
  # curl/unzip are installed below; remaining tools must exist before mutation.
  case "$command" in curl|unzip) continue;; esac
  command -v "$command" >/dev/null || fail "Missing preflight tool: $command"
done
arch=$(dpkg --print-architecture)
case "$arch" in amd64) asset=bun-linux-x64;; arm64) asset=bun-linux-aarch64;; *) fail "Unsupported architecture: $arch";; esac
pin=$(<"$ROOT/.bun-version")
[[ $pin =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid .bun-version pin.'
for file in Caddyfile derp.service tailscale-policy.hujson; do
  [[ -f $ROOT/deploy/vps/$file ]] || fail "Missing deployment template: $file"
done
[[ -f $SCRIPT_DIR/auth.sh ]] || fail 'Missing authentication helper.'
lock_host
if [[ -e /etc/derp/vps.conf ]]; then
  require_managed
  [[ $DERP_HOSTNAME == "$hostname" && $DERP_TAILSCALE_HOSTNAME == "$tailname" && $DERP_BUN_VERSION == "$pin" ]] || fail 'Managed hostname/Tailscale hostname/Bun pin differs; no implicit migration.'
else
  for path in /etc/derp /srv/derp /etc/caddy /var/lib/caddy /var/lib/tailscale /etc/default/tailscaled /etc/apt/sources.list.d/tailscale.list /usr/share/keyrings/tailscale-archive-keyring.gpg /usr/local/bin/bun /etc/systemd/system/derp.service /etc/systemd/system/caddy.service /etc/sudoers.d/derp-admin; do
    [[ ! -e $path && ! -L $path ]] || fail "Unmanaged path exists: $path"
  done
  for account in derp derp-admin; do
    if getent passwd "$account" >/dev/null || getent group "$account" >/dev/null; then fail "Unmanaged account/group: $account"; fi
  done
  for package in caddy tailscale; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | { read -r status || true; [[ $status == 'install ok installed' ]]; }; then fail "Unmanaged package: $package"; fi
  done
  for command in caddy tailscale; do
    if command -v "$command" >/dev/null; then fail "Unmanaged binary: $command"; fi
  done
  install -d -o root -g root -m 0700 /etc/derp
  printf 'DERP_HOSTNAME=%s\nDERP_TAILSCALE_HOSTNAME=%s\nDERP_BUN_VERSION=%s\n' "$hostname" "$tailname" "$pin" > /etc/derp/vps.conf
  chmod 0600 /etc/derp/vps.conf
fi
DERP_HOSTNAME=$hostname DERP_TAILSCALE_HOSTNAME=$tailname DERP_BUN_VERSION=$pin
mask_ordinary_ssh
# Debian package hooks must not start the unprotected packaged default site.
# Stop it during console package maintenance; every restart follows validation.
if systemctl is-active --quiet caddy.service; then systemctl stop caddy.service; fi
systemctl mask caddy.service
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl unzip caddy sudo ufw unattended-upgrades apt-listchanges
apt-get upgrade -y
[[ ! -e /var/run/reboot-required ]] || printf 'Reboot required: schedule through the provider console after verification.\n'
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg -o "$work/tailscale.gpg"
[[ -s $work/tailscale.gpg ]] || fail 'Empty Tailscale signing key.'
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] https://pkgs.tailscale.com/stable/debian trixie main' > "$work/tailscale.list"
install -o root -g root -m 0644 "$work/tailscale.gpg" /usr/share/keyrings/tailscale-archive-keyring.gpg
install -o root -g root -m 0644 "$work/tailscale.list" /etc/apt/sources.list.d/tailscale.list
apt-get update
apt-get install -y --no-install-recommends tailscale
systemctl enable --now tailscaled.service
if [[ -e /usr/local/bin/bun ]]; then
  require_bun
else
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "https://github.com/oven-sh/bun/releases/download/bun-v$pin/$asset.zip" -o "$work/bun.zip"
  unzip -p "$work/bun.zip" "$asset/bun" > "$work/bun"
  chmod 0755 "$work/bun"
  [[ $("$work/bun" --version) == "$pin" ]] || fail 'Downloaded Bun differs from pin.'
  install -o root -g root -m 0755 "$work/bun" /usr/local/bin/bun
fi
require_bun
if ! getent passwd derp-admin >/dev/null; then useradd --create-home --shell /bin/bash derp-admin; fi
usermod --shell /bin/bash --lock derp-admin
printf '%s\n' 'derp-admin ALL=(ALL) NOPASSWD: ALL' > "$work/sudoers"
chmod 0440 "$work/sudoers"
visudo -cf "$work/sudoers"
install -o root -g root -m 0440 "$work/sudoers" /etc/sudoers.d/derp-admin
if ! getent group derp >/dev/null; then groupadd --system derp; fi
if ! getent passwd derp >/dev/null; then useradd --system --gid derp --home-dir /nonexistent --shell /usr/sbin/nologin derp; fi
usermod --shell /usr/sbin/nologin --lock derp
install -d -o root -g root -m 0755 /srv/derp /srv/derp/releases
printf 'DERP_PUBLIC_ORIGIN=https://%s\n' "$hostname" > "$work/server.env"
install -o root -g root -m 0600 "$work/server.env" /etc/derp/server.env
# Render the only hostname placeholder without evaluating template contents.
while IFS= read -r line; do printf '%s\n' "${line//__DERP_HOSTNAME__/$hostname}"; done < "$ROOT/deploy/vps/Caddyfile" > "$work/Caddyfile"
[[ $(<"$work/Caddyfile") != *__DERP_* ]] || fail 'Unresolved Caddy placeholder.'
backup_once /etc/caddy/Caddyfile
cp -a /etc/caddy/Caddyfile "$work/Caddyfile.old"
install -o root -g caddy -m 0640 "$work/Caddyfile" /etc/caddy/Caddyfile
source "$SCRIPT_DIR/auth.sh"
if [[ ! -f /etc/caddy/derp-users.caddy ]]; then
  if ! set_basic_auth; then cp -a "$work/Caddyfile.old" /etc/caddy/Caddyfile; fail 'Authentication setup failed; Caddy not activated.'; fi
fi
if ! valid_basic_auth_file /etc/caddy/derp-users.caddy ||
   [[ $(stat -c '%u:%G:%a' /etc/caddy/derp-users.caddy) != 0:caddy:640 ]]; then
  cp -a "$work/Caddyfile.old" /etc/caddy/Caddyfile
  fail 'Unsafe/empty managed authentication file; Caddy remains masked.'
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  cp -a "$work/Caddyfile.old" /etc/caddy/Caddyfile
  fail 'Caddy validation failed; previous configuration restored.'
fi
systemctl unmask caddy.service
systemctl daemon-reload
if systemctl is-active --quiet caddy.service; then
  if ! systemctl reload caddy.service; then cp -a "$work/Caddyfile.old" /etc/caddy/Caddyfile; systemctl mask --now caddy.service; fail 'Caddy reload failed; previous configuration restored and Caddy masked.'; fi
else
  if ! systemctl enable --now caddy.service; then cp -a "$work/Caddyfile.old" /etc/caddy/Caddyfile; systemctl mask --now caddy.service; fail 'Caddy activation failed; previous configuration restored and Caddy masked.'; fi
fi
install -o root -g root -m 0644 "$ROOT/deploy/vps/derp.service" /etc/systemd/system/derp.service
systemctl daemon-reload
if [[ ! -L /srv/derp/current ]]; then systemctl disable --now derp.service; fi
if [[ -e /etc/derp/tailscale-enrolled && ! -e /var/lib/tailscale/tailscaled.state ]]; then
  fail 'Enrolled node state is missing; deliberate console identity recovery required.'
fi
if [[ ! -e /etc/derp/tailscale-enrolled ]]; then
  tailscale up --ssh --advertise-tags=tag:derp-vps --hostname="$tailname" --accept-dns=false --accept-routes=false --timeout=10m
else
  if ! tailscale status --json | /usr/local/bin/bun -e 'const s=await new Response(Bun.stdin.stream()).json();if(s.BackendState!=="Running"||!s.Self?.Tags?.includes("tag:derp-vps"))process.exit(1);'; then
    printf 'Console-only recovery: tailscale up --ssh --advertise-tags=tag:derp-vps --hostname=%s --accept-dns=false --accept-routes=false --timeout=10m --force-reauth\n' "$tailname" >&2
    fail 'Managed node disconnected/expired or tag changed; deliberate console review required.'
  fi
  [[ $(tailscale get ssh) == true ]] || tailscale set --ssh=true
  [[ $(tailscale get hostname) == "$tailname" ]] || tailscale set --hostname="$tailname"
  [[ $(tailscale get accept-dns) == false ]] || tailscale set --accept-dns=false
  [[ $(tailscale get accept-routes) == false ]] || tailscale set --accept-routes=false
fi
require_tailnet
tailip=$(tailscale ip -4)
[[ $tailip ]] || fail 'No Tailscale IPv4 address.'
install -o root -g root -m 0600 /dev/null /etc/derp/tailscale-enrolled
# Reject routing/exit-node/shields-up/web-client drift instead of silently widening scope.
[[ $(tailscale get advertise-routes) == '' && $(tailscale get advertise-exit-node) == false && $(tailscale get exit-node) == '' && $(tailscale get shields-up) == false && $(tailscale get webclient) == false && $(tailscale get auto-update) == false ]] || fail 'Unexpected Tailscale routing/exit-node/shields-up/web-client/auto-update settings; review from console.'
tailscale status --json | /usr/local/bin/bun -e 'const s=await new Response(Bun.stdin.stream()).json();console.log("Tailnet node:",s.Self?.DNSName??"(no MagicDNS)","expiry:",s.Self?.KeyExpiry??"inspect in admin console");'
printf 'Provisioned; SSH authorization remains unverified. Inspect tag and node expiry in the admin console.\nVerify from your user-owned operator device: tailscale ssh derp-admin@%s '\''id -un; sudo -n true'\''\nThen run harden.sh through that native SSH session.\n' "$tailip"
