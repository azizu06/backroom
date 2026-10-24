#!/usr/bin/env bash
# User-local ARM64 prerequisites. No shell profiles, system packages or shared services changed.
set -euo pipefail
umask 077
base="$HOME/$1"
[[ "$(uname -m)" == aarch64 ]] || { echo 'GX10 bootstrap requires Linux ARM64.' >&2; exit 1; }
mkdir -p "$base/.runtime/bin"
cd "$base/.runtime"
export PATH="$PWD/bin:$PATH"
if [[ ! -x bin/node ]]; then
  curl -fsSLo node.tar.xz https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-arm64.tar.xz
  curl -fsSLo SHASUMS256.txt https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
  grep ' node-v24.22.1-linux-arm64.tar.xz$' SHASUMS256.txt | sed 's/node-v24.22.1-linux-arm64.tar.xz/node.tar.xz/' | sha256sum -c -
  tar -xf node.tar.xz --strip-components=1
  rm node.tar.xz
fi
if [[ ! -f node_modules/pnpm/bin/pnpm.mjs ]]; then
  npm install --prefix "$PWD" pnpm@12.14.0 > npm-install.log 2>&1
fi
# npm may leave pnpm's target non-executable. Invoke it with Node explicitly.
rm -f bin/pnpm
cat > bin/pnpm <<'WRAPPER'
#!/usr/bin/env sh
exec "$(dirname "$0")/node" "$(dirname "$0")/../node_modules/pnpm/bin/pnpm.mjs" "$@"
WRAPPER
chmod 700 bin/pnpm
if [[ ! -x bin/cloudflared ]]; then
  curl -fsSLo bin/cloudflared https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-linux-arm64
  chmod 700 bin/cloudflared
fi
if [[ ! -x spacetime/spacetime ]]; then
  curl -fsSLo install-spacetime.sh https://install.spacetimedb.com
  SPACETIME_DOWNLOAD_ROOT=https://github.com/clockworklabs/SpacetimeDB/releases/download/v2.13.0 \
    sh install-spacetime.sh --root-dir "$PWD/spacetime" --yes > spacetime-install.log 2>&1
fi
node --version
pnpm --version
cloudflared --version
