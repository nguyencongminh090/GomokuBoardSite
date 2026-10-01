#!/usr/bin/env bash
# Copies the engine files into gate/public/engine (git-ignored, so GitHub Pages never publishes that copy), then deploys.
#   first time:  cd gate && npx wrangler login && npx wrangler secret put TOKEN_SECRET
#   after that:  gate/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p public/engine
cp ../engine/rapfi-*.js ../engine/rapfi-*.wasm ../engine/rapfi-*.data public/engine/
npx --yes wrangler deploy
