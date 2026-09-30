#!/usr/bin/env bash
# Rebuilds the Rapfi WebAssembly engine into this folder (see engine/README.md).
#
#   engine/build.sh <path to the rapfi repository> [path to a folder with config.toml and the model]
#
# The model folder defaults to <rapfi>/gomoku-portal-ui-distribute. Needs an activated Emscripten SDK
# (source ~/emsdk/emsdk_env.sh), CMake and Ninja.
set -euo pipefail

RAPFI=$(cd "${1:?usage: engine/build.sh <rapfi repo> [model dir]}" && pwd)
MODELS=$(cd "${2:-$RAPFI/gomoku-portal-ui-distribute}" && pwd)
OUT=$(cd "$(dirname "$0")" && pwd)
MODEL=Model20260727-V0-FreshValue.bin

command -v emcmake >/dev/null || { echo "emcmake not found: source ~/emsdk/emsdk_env.sh first" >&2; exit 1; }

# Rapfi's CMake preloads the files listed in Networks/wasm_preloads.txt into the engine's virtual
# file system, where the engine finds config.toml at start-up and the model it names.
NET="$RAPFI/Networks"
mkdir -p "$NET"
cp "$MODELS/$MODEL" "$NET/"
sed 's/^message_mode = .*/message_mode = "brief"/' "$MODELS/config.toml" > "$NET/config.toml"
printf 'config.toml@config.toml\n%s@%s\n' "$MODEL" "$MODEL" > "$NET/wasm_preloads.txt"

for variant in multi single; do
  build="$RAPFI/Rapfi/build/wasm-$variant-simd128"
  extra=()
  [ "$variant" = single ] && extra=(-DNO_MULTI_THREADING=ON)
  emcmake cmake -S "$RAPFI/Rapfi" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF "${extra[@]}"
  cmake --build "$build" --target rapfi # only the engine; the test targets do not build for wasm
  cp "$build/rapfi-$variant-simd128."{js,wasm,data} "$OUT/"
done

echo "Engine rebuilt from $(git -C "$RAPFI" rev-parse --short HEAD) into $OUT"
