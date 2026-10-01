#!/usr/bin/env bash
# Copies the engine files into gate/public/engine (git-ignored, so GitHub Pages never publishes that copy), then deploys.
# The engine files are kept outside this repository: $GOMOKU_ENGINE_DIR, default ../GomokuEngineFiles (see engine/README.md).
#   first time:  cd gate && npx wrangler login && npx wrangler secret put TOKEN_SECRET
#   after that:  gate/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p public/engine
SRC=$(cd "${GOMOKU_ENGINE_DIR:-../../GomokuEngineFiles}" && pwd)
cp "$SRC"/rapfi-*.js "$SRC"/rapfi-*.wasm "$SRC"/rapfi-*.data public/engine/
npx --yes wrangler deploy
