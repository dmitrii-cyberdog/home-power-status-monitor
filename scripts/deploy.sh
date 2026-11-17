#!/usr/bin/env bash
set -euo pipefail

tested_commit=${1:?Pass the commit that passed CI}
repo=https://github.com/dmitrii-cyberdog/home-power-status-monitor.git
app_dir="$HOME/projects/home-power-status-monitor"

echo "Deploying main to $app_dir"

mkdir -p "$app_dir"
cd "$app_dir"

if [[ ! -e .git ]]; then
  git init -b main
  git remote add origin "$repo"
fi

if [[ "$(git config --get remote.origin.url)" != "$repo" ||
      "$(git branch --show-current)" != main ]]; then
  echo 'Expected the public home-power-status-monitor repository on main.' >&2
  exit 1
fi

git fetch origin refs/heads/main

if [[ "$(git rev-parse FETCH_HEAD)" != "$tested_commit" ]]; then
  echo 'Skipping deployment because main has moved since CI ran.'
  exit 0
fi

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  echo 'Activate Node.js 24 for the deployment SSH user.' >&2
  exit 1
fi

command -v pm2 > /dev/null

tracked_changes=$(git status --porcelain --untracked-files=no)

if [[ -n "$tracked_changes" ]]; then
  echo 'Deployment stopped because the server checkout has tracked changes.' >&2
  exit 1
fi

git merge --ff-only --no-overwrite-ignore "$tested_commit"

if [[ "$(git rev-parse HEAD)" != "$tested_commit" ]]; then
  echo 'Deployment stopped because the server checkout is ahead of main.' >&2
  exit 1
fi

HUSKY=0 node .yarn/releases/yarn-4.18.0.cjs install --immutable
pm2 startOrRestart server.json --env prod
echo 'Deployment completed.'
