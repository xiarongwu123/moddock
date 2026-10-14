#!/usr/bin/env bash
set -euo pipefail

mode=${1:---check}
case "$mode" in --check|--dry-run|--apply|--remove) ;; *) printf 'Use --check, --dry-run, --apply or --remove\n' >&2; exit 2 ;; esac
network=${MODDOCK_NEXUS_DOCKER_NETWORK:-mu-account_default}
container=${MODDOCK_NEXUS_ACCOUNT_CONTAINER:-amd-dlss-mu-account}
port=${MODDOCK_NEXUS_PORT:-8095}
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || exit 2
network_id=$(docker network inspect "$network" --format '{{.Id}}')
[[ "$network_id" =~ ^[a-f0-9]{64}$ ]] || exit 2
read -r subnet gateway extra <<< "$(docker network inspect "$network" --format '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{println}}{{end}}')"
[[ -z "${extra:-}" && "$subnet" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+/[0-9]+$ && "$gateway" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+$ ]] || { printf 'A private IPv4 Docker network is required\n' >&2; exit 2; }
[[ "${MODDOCK_NEXUS_HOST:-$gateway}" == "$gateway" ]] || { printf 'Worker host does not match the Docker gateway\n' >&2; exit 2; }
bridge=$(docker network inspect "$network" --format '{{index .Options "com.docker.network.bridge.name"}}')
if [[ -z "$bridge" || "$bridge" == '<no value>' ]]; then bridge="br-${network_id:0:12}"; fi
[[ "$bridge" =~ ^[a-zA-Z0-9_.:-]{1,15}$ ]] || exit 2
image=$(docker inspect "$container" --format '{{.Image}}')

# Use the installed host UFW tools through the existing Docker administration access.
# Only UFW configuration is writable; the helper has NET_ADMIN and no other capabilities.
helper=(docker run --rm --pull never --network host --user 0:0 --cap-drop ALL --cap-add NET_ADMIN
 --security-opt no-new-privileges --read-only
 --tmpfs /run:rw,noexec,nosuid,size=1m --tmpfs /tmp:rw,noexec,nosuid,size=8m
 -v /usr:/usr:ro -v /etc/ufw:/etc/ufw:rw -v /etc/default/ufw:/etc/default/ufw:ro
 -v /etc/alternatives:/etc/alternatives:ro -e PYTHONDONTWRITEBYTECODE=1)
run_host() { local tool=$1; shift; "${helper[@]}" --entrypoint "$tool" "$image" "$@"; }
rule=(-i "$bridge" -p tcp -d "$gateway" --dport "$port" -s "$subnet" -j ACCEPT)
persisted="-A ufw-user-input -i $bridge -p tcp -d $gateway --dport $port -s $subnet -j ACCEPT"
configured() {
 run_host /usr/sbin/iptables -w 5 -C ufw-user-input "${rule[@]}" 2>/dev/null &&
 run_host /usr/bin/grep -Fqx -- "$persisted" /etc/ufw/user.rules
}
printf 'Private worker rule: %s -> %s:%s via %s\n' "$subnet" "$gateway" "$port" "$bridge"
if [[ "$mode" == --check ]]; then configured; printf 'Live and persistent rules verified\n'; exit 0; fi
args=(allow in on "$bridge" from "$subnet" to "$gateway" port "$port" proto tcp)
if [[ "$mode" == --dry-run ]]; then run_host /usr/sbin/ufw --dry-run "${args[@]}"; exit 0; fi
if [[ "$mode" == --apply ]] && configured; then printf 'Rule already active and persistent\n'; exit 0; fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
run_host /usr/bin/bash -c 'set -euo pipefail; umask 077; backup=/etc/ufw/moddock-nexus-backups/$1; mkdir -p "$backup"; cp -p /etc/ufw/user.rules /etc/ufw/user6.rules "$backup/"; printf "UFW backup: %s\n" "$backup"' bash "$stamp"
if [[ "$mode" == --remove ]]; then
 run_host /usr/sbin/ufw --force delete "${args[@]}"
else
 run_host /usr/sbin/ufw "${args[@]}"
 configured
 printf 'Live and persistent rules verified\n'
fi
