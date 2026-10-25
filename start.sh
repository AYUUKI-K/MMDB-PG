#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null; then
  echo '需要 Node.js 22+。Termux: pkg install nodejs-lts；Linux: 安装 Node.js 22+。'
  exit 1
fi
node -e "if(Number(process.versions.node.split('.')[0])<22){console.error('需要 Node.js 22+');process.exit(1)}"
if [ ! -f node_modules/ws/package.json ]; then npm ci --omit=dev --no-audit --no-fund; fi
node build.mjs
exec node launch.mjs "$@"
