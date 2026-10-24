#!/usr/bin/env bash
set -euo pipefail
umask 077
base="$HOME/$1"
action="$2"
ref="$3"
live="$4"
export PATH="$base/.runtime/bin:$PATH"
app="$base/app"
if [[ "$action" == up ]]; then
  command -v node >/dev/null
  command -v pnpm >/dev/null
  command -v cloudflared >/dev/null
  mkdir -p "$base"
  mkdir "$base/deploy.lock" || { echo 'Another deployment owns this host directory.' >&2; exit 1; }
  trap 'rmdir "$base/deploy.lock"' EXIT
  if [[ ! -d "$app/.git" ]]; then
    git clone https://github.com/azizu06/backrooms.git "$app"
  fi
fi
cd "$app"
# Reuse the live checkout without replacing code under its process.
if [[ "$action" == up && ! -f .demo/owner.lock ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'GX10 checkout has tracked changes; refusing update.' >&2; exit 1; }
  git fetch origin "$ref"
  git checkout --detach FETCH_HEAD
  echo "GX10 release: $(git rev-parse HEAD)"
  pnpm install --frozen-lockfile > "$base/install.log" 2>&1
  # All sponsor vars stay private. This file is never printed or sourced as shell code.
  cp /srv/team/backroom.env .env.local
  chmod 600 .env.local
  # Maincloud worker supplies this private file after publishing a fresh host database.
  if [[ -f "$base/state.env" ]]; then
    chmod 600 "$base/state.env"
    printf '\n' >> .env.local
    cat "$base/state.env" >> .env.local
  fi
  mkdir -p .demo
  # Build-time must not connect to the runtime DB or start sponsor integrations.
  STATE_STORE=memory pnpm -r build > "$base/build.log" 2>&1
fi
# A host.env file may select Maincloud/local-state mode and voice readiness, never shell code.
# node --env-file preserves explicit process env overrides and demo CLI loads sponsor settings.
args=(--env-file="$base/anthropic.env")
[[ ! -f "$base/host.env" ]] || args+=(--env-file="$base/host.env")
export DEMO_PORT=3340 DEMO_STATE_PORT=3341 VOICE_PORT=3342
export DEMO_BIND_HOST=100.117.44.20 DEMO_STATE_BIND_HOST=100.117.44.20 DEMO_PREBUILT=1
export SPACETIME_CLI="$base/.runtime/spacetime/spacetime" SPACETIME_ROOT="$base/.runtime/spacetime"
# CLI detaches its owned supervisor; no system service, sudo, shared tmux or Ollama mutation.
if [[ "$action" == up ]]; then
  ss -ltn
fi
loader="$(node -p 'require.resolve("tsx", {paths:["./orchestrator"]})')"
# CLI accepts --live after its action, not as a Node option.
extra=()
[[ "$live" != 1 ]] || extra+=(--live)
node "${args[@]}" --import "$loader" tools/demo/cli.ts "$action" "${extra[@]}"
