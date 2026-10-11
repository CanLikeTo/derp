#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
source "$SCRIPT_DIR/common.sh"
usage() {
  printf 'Usage: sudo bash %s --dist-dir PATH --release ID\n       sudo bash %s --activate ID\nOnly built client/server artifacts are shipped; activation restarts and resets the room.\n' "$0" "$0"
}
dist='' release='' activate=''
while (($#)); do
  case "$1" in
    --dist-dir|--release|--activate)
      (($# >= 2)) || fail "Missing value for $1"
      case "$1" in --dist-dir) dist=$2;; --release) release=$2;; --activate) activate=$2;; esac
      shift 2;;
    --help) usage; exit 0;;
    *) usage >&2; fail "Unknown argument: $1";;
  esac
done
if [[ $activate ]]; then
  [[ ! $dist && ! $release ]] || fail '--activate cannot be combined with a new release.'
  release=$activate
else
  [[ $dist && $release ]] || fail 'Provide --dist-dir and --release, or --activate.'
fi
[[ $release =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || fail 'Invalid release ID.'
require_root
lock_host
require_managed
require_bun
[[ -d /srv/derp/releases && ! -L /srv/derp/releases && $(stat -c '%u:%a' /srv/derp/releases) == 0:755 ]] || fail 'Unsafe managed releases directory.'
[[ -f /etc/systemd/system/derp.service ]] || fail 'Missing runtime unit.'
ordinary_tree() {
  local path=$1 bad
  [[ -d $path && ! -L $path && -f $path/client/index.html && -f $path/server/main.js ]] || fail 'Expected ordinary client/index.html and server/main.js.'
  bad=$(find "$path" ! \( -type f -o -type d \) -print -quit)
  [[ ! $bad ]] || fail 'Artifact tree contains a symlink or special file.'
}
immutable_release() {
  ordinary_tree "$1"
  local bad
  bad=$(find "$1" \( ! -user root -o -perm /022 \) -print -quit)
  [[ ! $bad ]] || fail 'Release must be root-owned and not group/world writable.'
}
staging='' link=''
cleanup() { [[ ! $staging ]] || rm -rf -- "$staging"; [[ ! $link ]] || rm -f -- "$link"; }
trap cleanup EXIT
if [[ ! $activate ]]; then
  [[ ! -e /srv/derp/releases/$release && ! -L /srv/derp/releases/$release ]] || fail 'Release ID already exists.'
  ordinary_tree "$dist"
  staging=$(mktemp -d /srv/derp/releases/.staging.XXXXXX)
  cp -a -- "$dist/client" "$dist/server" "$staging/"
  ordinary_tree "$staging"
  chown -R root:root "$staging"
  find "$staging" -type d -exec chmod 0755 {} +
  find "$staging" -type f -exec chmod 0644 {} +
  mv -T -- "$staging" "/srv/derp/releases/$release"
  staging=''
fi
target=/srv/derp/releases/$release
immutable_release "$target"
old=''
if [[ -L /srv/derp/current ]]; then
  old=$(readlink /srv/derp/current)
  [[ $old == /srv/derp/releases/* && ${old#/srv/derp/releases/} =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || fail 'Unexpected current target.'
  immutable_release "$old"
elif [[ -e /srv/derp/current ]]; then
  fail 'Current is not a managed release symlink.'
fi
switch_link() {
  local destination=$1 name=$2
  link="/srv/derp/.$name.$$.$RANDOM"
  ln -s -- "$destination" "$link"
  mv -Tf -- "$link" "/srv/derp/$name"
  link=''
}
ready() {
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if systemctl is-active --quiet derp.service && /usr/local/bin/bun -e '
      try {
        const r=await fetch("http://127.0.0.1:3001/health",{signal:AbortSignal.timeout(2000)});
        if(r.status!==200 || (await r.json()).ready!==true) process.exit(1);
      } catch { process.exit(1); }
    ' && systemctl is-active --quiet derp.service; then return 0; fi
    sleep 1
  done
  return 1
}
switch_link "$target" current
if systemctl restart derp.service && ready; then
  if ! systemctl enable derp.service; then fail 'Release healthy but boot activation failed; inspect systemd.'; fi
  if [[ $old && $old != "$target" ]]; then switch_link "$old" previous; fi
  printf 'Activated release %s; room restarted.\n' "$release"
else
  printf 'dERP: activation failed for %s; retaining release and journal.\n' "$release" >&2
  if [[ $old ]]; then
    switch_link "$old" current
    if systemctl restart derp.service && ready; then
      printf 'Recovered previous release %s.\n' "${old##*/}" >&2
    else
      printf 'dERP: previous release also failed health; inspect journalctl -u derp through console/native SSH.\n' >&2
    fi
  else
    rm -f /srv/derp/current
    systemctl stop derp.service
    printf 'Failed first deployment stopped; no current target.\n' >&2
  fi
  exit 1
fi
