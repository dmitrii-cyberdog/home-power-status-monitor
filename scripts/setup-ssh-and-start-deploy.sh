#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 || -z "$1" || "$2" != main ]]; then
  echo "Usage: $0 <HOST> main" >&2
  exit 1
fi

host="$1"

: "${SSH_USER:?Set SSH_USER}"
: "${SSH_KEY:?Set SSH_KEY}"
: "${SSH_KNOWN_HOSTS:?Set SSH_KNOWN_HOSTS}"
: "${GITHUB_SHA:?Set GITHUB_SHA}"

if [[ ! "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a Git commit SHA from CI.' >&2
  exit 1
fi

#
#

ssh_dir=$(mktemp -d)
trap 'rm -f -- "$ssh_dir/id_ed25519" "$ssh_dir/known_hosts"; rmdir -- "$ssh_dir"' EXIT

umask 077
printf '%s\n' "$SSH_KEY" > "$ssh_dir/id_ed25519"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"

#
#

for attempt in 1 2 3; do
  echo "Deploying main (attempt $attempt/3)"

  if ssh -T -i "$ssh_dir/id_ed25519" \
    -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" \
    -l "$SSH_USER" -- "$host" \
    "bash -il -c 'bash -s -- $GITHUB_SHA'" < scripts/deploy.sh; then
    exit 0
  fi

  if [[ "$attempt" -lt 3 ]]; then
    sleep "$((attempt * 3))"
  fi
done

echo 'Deployment failed after three attempts.' >&2
exit 1
