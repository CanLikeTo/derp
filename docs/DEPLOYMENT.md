# Private Debian VPS playtests

This deploys the built anonymous two-player playground, not production account/ticket/lobby authentication. Caddy protects **all HTTPS HTML, assets, health and WebSocket requests** with one shared Basic-auth user, `tester`. Browser players do not need Tailscale. Administration is **native Tailscale SSH only**, authorized by tailnet identity as `derp-admin`; ordinary OpenSSH is persistently masked, including during bootstrap. There is no SSH key or public-SSH fallback.

## Prerequisites and boundaries

- Dedicated **Debian 13**, amd64 or arm64, systemd, working `/dev/net/tun`, retained provider serial/VNC/root console and snapshot. Start with 2 vCPU / 2 GiB RAM, not a measured capacity guarantee. Do not run these scripts on the workstation or a shared server.
- **Before first boot**, provider ingress defaults to deny on every public/private-underlay IPv4/IPv6 address. Allow only TCP 80/443, established return traffic and required ICMP/ICMPv6; allow outbound traffic. Deny TCP 22 and image-specific alternate SSH ports. Provider web-SSH is not an out-of-band console.
- Public DNS A record; add AAAA only when IPv6 actually works. HTTPS uses normal publicly trusted certificates, never plaintext Basic auth or TLS bypass. Caddy handles ACME and redirects on port 80; open HTTPS first.
- Workstation: pinned Bun from `.bun-version`, Node 24+, repository dependencies, GNU tar/base64, system SSH client, Tailscale and Playwright's Chromium/Firefox/WebKit prerequisites. Close local dev/preview processes before fixed-port checks.
- Authorized human tailnet operator identity and **user-owned**, untagged client; tailnet policy/tag administration permissions and a real nonoperator identity/device for denial checks. There are no stored auth keys/API tokens.
- Password-manager-generated tester password of at least 20 characters, shared privately only with invited testers. It never goes into URLs, command arguments, checkout, client assets or diagnostics.

`derp-admin` has a locked password, no generated SSH keys, and passwordless full sudo. It is an identity-authorized host administrator, not a restricted deploy principal. `derp` is a nonlogin service user without sudo. Bun and release files are root-owned and unwritable by `derp`/`caddy`.

## 1. Publish and validate tailnet policy

Edit the template `deploy/vps/tailscale-policy.hujson` with the actual operator login(s) in `group:derp-operators`; replace the sample authorized and unrelated test identities. Merge its named sections into the existing policy at <https://console.tailscale.com/admin/acls>, retaining unrelated sections.

The fixed `tag:derp-vps` has a network grant for operator TCP 22 and an SSH **check** rule allowing only `derp-admin`. Neither `root`, `derp`, `autogroup:nonroot`, wildcard users nor all-member access belongs in its SSH rules. **Grants, legacy ACLs and SSH rules are additive**: narrow/remove any overlapping broad rule that permits other principals or local users on this node/tag, including rules through other tags. Negative tests are assertions, not overriding deny rules. Save only with all network `tests` and `sshTests` passing. Do not enroll until policy conflicts are resolved.

Check mode uses its default 12-hour authentication freshness. The template omits paid-plan custom `checkPeriod`. Freshness is not a maximum session lifetime or a guarantee of MFA. Tagged server key expiry is disabled by default on initial authentication; inspect its actual setting in the console. Human device expiry, SSH reauthentication and server enrollment lifetime are distinct.

## 2. Bootstrap through the provider console

First run repository checks/build on the workstation:

```sh
bun install --frozen-lockfile
bun test tests/integration/server.test.ts
bun run check
bun run build
bun run test:e2e
```

Create a credential-free setup payload (not Tailscale state or game credentials):

```sh
tar -czf /tmp/derp-setup.tgz scripts deploy .bun-version
base64 -w 76 /tmp/derp-setup.tgz
```

Paste the complete base64 output into the **provider serial/VNC console**:

```sh
umask 077
mkdir -p /root/derp-setup
base64 -d > /root/derp-setup.tgz <<'DERP_SETUP'
<paste the complete base64 payload>
DERP_SETUP
tar -xzf /root/derp-setup.tgz -C /root/derp-setup
bash /root/derp-setup/scripts/vps/provision.sh \
  --hostname playtest.example.com --tailscale-hostname derp-vps
```

Replace the public hostname; the Tailscale hostname is a lowercase single DNS label. Provisioning refuses unsupported hosts, invalid names, SSH-session package maintenance, unmanaged Caddy/Tailscale/accounts/data and an unrelated preexisting Bun. It writes installation intent before package/account mutations so identical reruns can resume; differing stored hostnames/pin fail, without implicit migration.

The provisioner masks ordinary SSH **before** installing packages. It installs Debian Caddy/sudo/UFW/security-upgrade tooling, a signed stable Tailscale apt source with dedicated `signed-by` keyring, and exactly `.bun-version` from the official pinned GitHub ZIP. HTTPS transport is Bun's download trust boundary, not an independently verified signature. No Node, Vite, Playwright, database, Docker or OpenSSH server is installed. Apt upgrades do not trigger automatic reboot; schedule any reported reboot deliberately.

Before changing host state, provisioning rejects SSH environment indicators and walks the Linux `/proc` ancestor chain through `sudo` to PID 1. Any `sshd`, `sshd-session` or `tailscaled` ancestor is refused even when sudo clears `SSH_*`. Unreadable/incomplete ancestry also fails closed. `SUDO_USER` alone is not a remote-session signal: legitimate provider-console sudo remains allowed. Do not use a detached launcher to bypass this safety check.

Provisioning also stops/masks Caddy during console package maintenance, preventing Debian's unauthenticated default site from starting. It unmasks Caddy only after validating the exact managed tester/bcrypt block and the full config with the admin API disabled. Failed validation/activation restores the previous Caddyfile and restarts it only if that restored config also validates with `admin off`; unsafe legacy/default backups or failed recovery leave Caddy masked. An empty import is valid Caddy syntax but must never count as authentication. Identical provisioning reruns can interrupt HTTPS while reconciling packages/configuration.

The initial command runs:

```sh
tailscale up --ssh --advertise-tags=tag:derp-vps \
  --hostname=derp-vps --accept-dns=false --accept-routes=false --timeout=10m
```

Follow its browser authorization URL as an authorized tag owner and approve the node when required. Timeout/failed approval leaves ordinary SSH blocked. Verify `tag:derp-vps` and actual key-expiry state in the admin console. Leave netfilter mode `on`; no Serve/Funnel, auto-update, advertised routes, exit node, shields-up or persistent web client.

At Caddy's hidden controlling-TTY prompt, enter the tester password. Only a validated bcrypt hash is stored, root:caddy mode 0640 in `/etc/caddy/derp-users.caddy`; the Caddyfile also has mode 0640. Debian's Caddy 2.6.2 uses **`basicauth`**, not the newer `basic_auth` spelling. Full config validation precedes activation; auth executes before both proxy/static handlers. Caddy strips Authorization upstream, sets Bun's exact loopback Host, and preserves Origin. No public health exception, SPA fallback, directory listing or unauthenticated game route exists.

The global `admin off` disables Caddy's unauthenticated localhost:2019 API, including access from the `derp` service user. UFW and off-host port probes do not protect loopback. Validation privately consumes `caddy adapt --validate` JSON with pinned Bun and requires `admin.disabled=true`, including during rollback. Debian's API-based `caddy reload`/`systemctl reload caddy` is therefore not used: configuration and credential changes use validated `systemctl restart caddy`, disconnecting existing proxy connections. To upgrade an existing setup, reapply the updated setup bundle and rerun provisioning through the provider console; updating a checkout or rotating credentials alone does not install the new Caddyfile.

Bun remains stopped/disabled until a successful first release. Caddy certificate storage and `/var/lib/tailscale` identity are persistent package state; never archive them with releases or expose them through the web root.

If no serial/VNC console exists, use cloud-init/user-data or rescue facilities with SSH still blocked, then retain an interactive out-of-band terminal for enrollment/password entry. A provider with no such facility is unsuitable. No temporary public SSH exception.

## 3. Prove native SSH before hardening

Use the **observed Tailscale IP** printed by provisioning (or its actual printed MagicDNS name), not the public game hostname. Set workstation variables:

```sh
VPS=<public-address>
HOSTNAME=playtest.example.com
TAIL_ADDRESS=<observed-Tailscale-IP>
ADMIN=derp-admin@$TAIL_ADDRESS
tailscale ping --c=3 --until-direct=false "$TAIL_ADDRESS"
tailscale ssh "$ADMIN" 'id -un; sudo -n true'
tailscale ssh "$ADMIN" \
  'sudo bash /root/derp-setup/scripts/vps/harden.sh'
tailscale ssh "$ADMIN" 'id -un; sudo -n true'
```

Both logins must report `derp-admin` and successful sudo, including check-mode browser reauthentication when prompted. A Running daemon alone is not SSH authorization proof. `tailscale ssh` validates host keys using control-plane-distributed keys and supports trailing remote-command arguments; verify that before transfer. Do not use `StrictHostKeyChecking=no`, public-host fallback, or tagged human clients. Keep the provider console open during hardening.

Hardening requires `SUDO_USER=derp-admin`, valid managed sudoers, active/enabled tailscaled, Running/tagged node, SSH enabled and netfilter mode `on`. It never restarts tailscaled. It refuses unrelated UFW user rules rather than resetting them. Its only user ingress rules are IPv4/IPv6 TCP 80/443 (`derp-http`, `derp-https`), with incoming/routed deny and outgoing allow. No SSH, CGNAT-range or broad tailscale0 allowance. Native SSH authorization is in tailnet policy, not UFW/OpenSSH. Tailscale's early netfilter rules may accept overlay UDP locally; omitting a UFW UDP rule does not prove host-blocked UDP. No provider UDP 41641 allowance is needed initially; NAT traversal or outbound-443 DERP relays work. Diagnose using `tailscale netcheck`, not hardcoded relay IPs.

If UFW currently disables IPv6, saved IPv6 user rules must be reviewed/removed through the console before enabling it; the ordinary `show added` output hides those rules. The hardener refuses saved rules in this state rather than resurrecting an old IPv6 SSH/extra-port exception.

Security updates use only Debian security origins; automatic reboot is false. Bun and Tailscale updates remain deliberate. Inspect:

```sh
tailscale ssh "$ADMIN" 'sudo systemctl is-enabled ssh.service; sudo systemctl is-active ssh.service'
tailscale ssh "$ADMIN" 'sudo systemctl is-enabled ssh.socket; sudo systemctl is-active ssh.socket'
tailscale ssh "$ADMIN" 'sudo systemctl is-enabled tailscaled; sudo systemctl is-active tailscaled'
tailscale ssh "$ADMIN" 'sudo tailscale get ssh; sudo tailscale get netfilter-mode; sudo tailscale status; sudo tailscale ip -4; sudo tailscale ip -6'
tailscale ssh "$ADMIN" 'sudo ss -ltnp; sudo ufw status verbose; sudo ufw show raw'
tailscale ssh "$ADMIN" 'sudo unattended-upgrade --dry-run --debug'
tailscale ssh "$ADMIN" 'sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
```

Ordinary SSH units must be **masked/inactive** (their status commands can return nonzero); tailscaled **enabled/active**, SSH true, netfilter on. No kernel sshd listener is expected, including on alternate ports. Native SSH can work without a kernel TCP 22 listener. Inspect effective firewall rules, saved tailnet policy and the signed repository, not just `ufw status`.

From the operator device, both `timeout 15s tailscale ssh root@"$TAIL_ADDRESS"` and `timeout 15s tailscale ssh derp@"$TAIL_ADDRESS"` must be denied. From a real nonoperator tailnet device, `derp-admin` must be denied. Simultaneously prove approved admin works. From a non-tailnet network, public IPv4/IPv6 SSH must fail, including formerly used image SSH ports; even a successful TCP connection/authentication prompt is failure evidence.

Console reruns with identical provision arguments preserve credentials, releases and node identity. Hardening reruns produce no duplicate rules or daemon reset. Missing/changed node tag, expired/disconnected enrollment or deleted enrolled identity fails for deliberate console recovery.

## 4. Upload and activate built artifacts

Build off-host, then transfer **only dist** over native Tailscale SSH stdin:

```sh
bun run build
RELEASE=$(date -u +%Y%m%dT%H%M%SZ)
tar -cf - dist | tailscale ssh "$ADMIN" \
  'mkdir -p /home/derp-admin/derp-upload &&
   tar -xf - -C /home/derp-admin/derp-upload'
tailscale ssh "$ADMIN" \
  "sudo bash /root/derp-setup/scripts/vps/deploy.sh \
   --dist-dir /home/derp-admin/derp-upload/dist --release '$RELEASE'"
tailscale ssh "$ADMIN" \
  'sudo systemctl status derp caddy tailscaled --no-pager; sudo ss -ltnp'
```

Release IDs are 1–64 alphanumeric/underscore/hyphen characters, starting alphanumeric. Existing IDs cannot be overwritten. The deployer requires `client/index.html` and `server/main.js`, rejects symlinks/special files throughout the upload, copies only client/server, normalizes root ownership and 0755/0644 modes, and atomically publishes the release. No source, node_modules or Vite service. The sandboxed Bun service binds only `127.0.0.1:3001`; its public origin must be canonical HTTPS. A configured origin replaces, rather than extends, the two local frontend origins. Host checks remain exact loopback authority.

Activation atomically changes `/srv/derp/current`, restarts Bun and polls health/readiness with bounded requests for 30 seconds. First success enables boot start; previous is recorded only on success. Failed startup/readiness restores/rechecks the old release and exits nonzero even after recovery. A failed first deployment removes current and stops the unit. Failed releases/logs remain; no automatic pruning or Caddy restart just for artifact deployment.

```sh
tailscale ssh "$ADMIN" 'sudo readlink /srv/derp/current; sudo readlink /srv/derp/previous'
tailscale ssh "$ADMIN" \
  'sudo bash /root/derp-setup/scripts/vps/deploy.sh --activate <previous-id>'
tailscale ssh "$ADMIN" 'sudo journalctl -u derp -u caddy -u tailscaled --no-pager -n 100'
```

Every Bun release restart/rollback disconnects players and destroys the single in-memory room. Refresh/reconnect creates fresh anonymous identities; this is not seamless match recovery. Caddy and Bun do not depend on tailscaled for browser play.

## 5. Verify protected HTTPS and real browser WSS

From an independent non-tailnet network, check each public IPv4/IPv6 address with `nc -vz -w 3 <address> <port>` for **22, 3001, 4173, 5173, 2019 and any former image SSH port**. All must fail while approved native SSH and HTTPS simultaneously work. Only TCP 80/443 are intended ingress. Never use `curl -k` or disable browser TLS verification.

In the approved admin shell **on the VPS**, also probe loopback as the application user:

```sh
sudo -u derp timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/2019'
sudo -u derp timeout 3 bash -c 'exec 3<>/dev/tcp/::1/2019'
sudo ss -ltnp
```

Both probes must fail immediately with **Connection refused**; a timeout or another error is not valid proof. There must be no Caddy admin listener, on port 2019 or another address. Repeat after provisioning, credential rotation, rollback and reboot while protected HTTPS still works. No admin response should be fetched or logged: it can contain the bcrypt hash.

Run the browser smoke off-host from a checkout with the pinned Bun version and frozen dependencies. Install Playwright's Chromium, Firefox and WebKit plus their system runtime libraries on a supported smoke workstation (`bun x playwright install --with-deps`). Those browser packages do not belong on the VPS.

Read the tester password without putting it in history:

```sh
read -r -s -p 'Tester password: ' DERP_BASIC_PASSWORD
printf '\n'
export DERP_BASIC_PASSWORD
DERP_VPS_URL="https://$HOSTNAME" DERP_BASIC_USER=tester \
  bun tools/vps-smoke.ts
unset DERP_BASIC_PASSWORD
```

The smoke requires canonical HTTPS and credentials before requests; HTTP calls time out at 10 seconds, browser navigation/assertions at 45 seconds. It prints only sanitized route/browser/build/player/tick/movement evidence, no traces/HARs/credentials. It checks:

- HTML, emitted asset, health and WebSocket upgrade all challenge missing/wrong credentials with 401.
- HTTP redirects with empty 308 to HTTPS, no auth prompt or game body.
- Authenticated health ready/build agreement and advancing ticks; missing/hostile WS Origin denied with 403.
- Sequential Chromium/Firefox/WebKit ordinary Basic-auth page navigation, **real same-origin WSS** with no injected browser Authorization headers; two identities and two snapshots, advancing ticks, predicted movement confirmed in the observer's authoritative snapshot, third-player Room full, and released-seat reuse; no page errors.

This deliberately leaves `playwright.config.ts` and local e2e/soak endpoints unchanged. Run on an idle test room. A failed browser remains unsupported until diagnosed; do not weaken auth/Origin checks, embed secrets in the client/query, or introduce a second auth stack.

Rotate credentials through a hidden TTY prompt (the Tailscale wrapper command must allocate a TTY for the interactive script):

```sh
# Open an interactive native SSH shell, then run inside it:
tailscale ssh "$ADMIN"
sudo bash /root/derp-setup/scripts/vps/auth.sh
```

The sourceable auth function shares provisioning's lock; standalone rotation acquires the same `/run/lock/derp-vps.lock` and verifies pinned Bun. It validates the full Caddy configuration with `admin off`, then restarts only when active; stopped bootstrap stays stopped. Failure restores the prior users file, validates the restored config and, if a restart was attempted, restarts it again so the restored credentials actually serve. Failed recovery requests a stop and reports console recovery; failed file restoration retains private recovery files instead of discarding the backup. Reprovisioning never rotates the hash. Old credentials must fail in a **fresh** request/browser context; cached responses/open WebSockets are not a revocation check. Rotation/restart disconnects sockets.

## 6. Recovery, reboot and manual playtest gates

On disposable snapshots only:

1. Activate a second known-good release, observe socket closure/fresh admission, roll back with `--activate`, rerun HTTPS smoke. Deploy another complete tree whose server exits immediately: expect failure plus healthy old current. Repeat with no previous release: no current and failed unit stopped, no unauthenticated game.
2. Reboot with console retained. Verify persistent SSH masks, same Tailscale identity/tag, permitted/denied native/public logins, UFW, Caddy certificate state, boot-active Bun and full HTTPS smoke.
3. Exercise unsupported OS, malformed hostnames, missing TUN, unmanaged package/account/data/firewall, unjoined/unapproved/denied-tag node and bad Caddy config/hash. From an approved native SSH login, retry provisioning via sudo with the stored valid hostnames: expect console-only refusal before Caddy, Tailscale, packages or managed files change, even with `SSH_*` removed. Confirm the identical command still works through provider-console sudo. Every failure must leave ordinary SSH closed and must not falsely declare authorization proved.
4. **From the provider console**, stop tailscaled. Native SSH must become unavailable while public HTTPS/Basic auth/Bun remain functional and public SSH remains blocked. Restart from console, repeat positive/negative logins without reenrollment. Never stop/down/logout from the sole remote session.
5. With healthy control plane, another retained operator and console recovery, remove a disposable operator from `group:derp-operators` during their active SSH session. Save policy: session must terminate and new login fail; retained operator still works. Restore intended membership. This proves identity revocation, not just transport; it does not promise revocation/new check-mode login during control-plane outage.
6. Two humans on independent desktop networks open HTTPS, enter Basic credentials, Connect and activate both arenas. Follow [PLAYTEST.md](PLAYTEST.md) for damage/death/respawn, jets, focus/blur/reconnect/reset and a deliberate service restart. Record browser/device/build, **measured WAN RTT**, synthetic preset, surprises and exported diagnostics. Zero added delay does not mean zero network delay. Playwright WebKit is not actual Safari; manually verify supported Safari as well as Chrome/Firefox.
7. From the console, induce Caddy validation/restart failure during provisioning and credential rotation. The command must fail even when the previous secure configuration/credentials recover and serve protected HTTPS. Failed recovery must leave the proxy stopped/masked; an admin-enabled legacy/default backup must never be started. Repeat the application-user loopback probes. These are actual Debian unit/recovery gates, not satisfied by a process-controller smoke.

Tailscale package upgrades/restarts and provisioning reruns belong in the **provider console**, since upgrades can restart the only SSH path. Preserve `/var/lib/tailscale`. For deliberate expiry/revocation recovery, check networking/DNS/time, repair the signed package/service and, only when intentionally reauthenticating, run from the console:

```sh
tailscale up --ssh --advertise-tags=tag:derp-vps \
  --hostname=derp-vps --accept-dns=false --accept-routes=false \
  --timeout=10m --force-reauth
```

Use the stored name from `/etc/derp/vps.conf`. No `up --reset`, automatic force-reauth/logout, public OpenSSH fallback, state replacement or human client tagging. Revoke a compromised server identity and deliberately replace it via console. Tailscale DNS/routes are not accepted and no fixed relay-IP allowlist is assumed. Package installation is not transactional; script config restoration is not a promise to undo packages or every firewall state transition.

## Evidence boundaries

Repository implementation and local checks do not mean a VPS, tailnet policy, public DNS or human test was configured. Record live enrollment/policy/login/firewall/TLS/browser/reboot/rollback/outage/revocation evidence separately when an authorized disposable host is supplied. Current historical gameplay validation remains in [VALIDATION.md](VALIDATION.md) and [PLAYTEST.md](PLAYTEST.md), unchanged by adding deployment tooling.

Recorded local implementation checks:

- Bun 1.4.0 frozen install and production build passed; `bun run check` passed formatting, TypeScript, package boundaries and **92 tests / 3,367 assertions**, including the exact-origin and remote-ancestry integration cases.
- The copied standalone server bundle ran without source or node_modules, returned ready health and admitted a real WebSocket baseline.
- Caddy 2.6.2 loopback checks proved protected HTML/assets/health/WS, rejected wrong credentials and hostile/missing WS origins, and carried an authenticated WebSocket baseline. Temporary-CA HTTPS checks exercised the remote smoke's eight missing/wrong-credential challenges without disabling TLS verification. The full remote smoke was **not** completed: this workstation cannot bind HTTP port 80 and no authorized public target was supplied.
- Local browser checks passed **40 Chromium/Firefox cases and 19 WebKit cases**. WebKit required temporary, process-scoped runtime libraries here. Its carbine test timed out at `tests/e2e/playground.spec.ts:399` waiting for observer player impacts; the same failure reproduced against committed HEAD in an isolated build. Gameplay and that assertion were not changed. A real built-client browser session also admitted, rendered and advanced authoritative movement.
- Console-guard review checks used real Linux process names from Bash symlinks, not SSH daemons or a mocked `/proc`: with SSH variables removed and a retained sudo-like intermediary, all three remote daemon names were refused while an agetty-style chain with `SUDO_USER` present was allowed. Empty process names and direct SSH indicators were refused. These checks did not execute sudo, package maintenance or host-service mutations.
- Caddy admin/restart review verification passed **10 scenarios** in private user/mount/network namespaces using real Caddy 2.6.2, the unchanged interactive `auth.sh` and the provisioning activation block. Both loopback families returned `ECONNREFUSED` on 2019. Real HTTP responses proved credential rotation, restored credentials and restored Caddyfile headers; port-collision restart failures exercised successful recovery, stopped/masked recovery failure, unsafe-backup refusal and normal activation. A test process controller substituted for systemd; this is not proof of Debian's unit, the full provisioner or real `derp` account permissions.
- Bash syntax, Shellcheck and local CLI/auth-config boundary smokes passed. These are not proof of actual Debian provisioning, SSH authorization, firewall enforcement, systemd sandboxing, release rollback, reboot, outage recovery or identity revocation; those remain live-host gates above.

Primary operational references: [Debian Caddy](https://packages.debian.org/trixie/caddy), [Caddy Basic auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [native Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh), [CLI settings](https://tailscale.com/docs/reference/tailscale-cli), [policy/tests](https://tailscale.com/docs/reference/syntax/policy-file), [signed stable repository](https://pkgs.tailscale.com/stable/), [UFW integration](https://tailscale.com/docs/how-to/secure-ubuntu-server-with-ufw), [netfilter modes](https://tailscale.com/docs/reference/netfilter-modes).
