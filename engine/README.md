# Engine files

**The six `rapfi-*` files are not in this repository.** They live in `../GomokuEngineFiles` (or `$GOMOKU_ENGINE_DIR`),
and the site loads them from the engine gate, a Cloudflare Worker (`gate/`) that serves them only to allow-listed keys.
Back that folder up: it is the only copy besides the Worker. `gate/deploy.sh` uploads it.

The analysis engine is **Rapfi**, compiled to WebAssembly from the MINT-P fork, which adds the WALL rule:
<https://github.com/nguyencongminh090/MINT-P> (built from commit `4a0e8bc`).

Rapfi is free software under the **GNU General Public License v3**. The engine files are
built from that source without changes, and the upstream project is <https://github.com/dhbloo/rapfi>.
The rest of this site stays under its MIT licence; the engine runs as a separate program that the
page talks to through its text protocol.

| File | Role |
|---|---|
| `rapfi-multi-simd128.{js,wasm,data}` | Multi-threaded build (needs a cross-origin isolated page) |
| `rapfi-single-simd128.{js,wasm,data}` | Single-threaded build (any page served over http(s)) |
| `engine.worker.js` | Web Worker that hosts either build and relays protocol lines |
| `build.sh` | Rebuilds the six engine files from the Rapfi source into `../GomokuEngineFiles` |

The `.data` file holds what the engine loads at start-up: `config.toml` (from the Portal UI package,
with `message_mode = "brief"`) and the classical evaluation model `Model20260727-V0-FreshValue.bin`.
The classical evaluator reads walls through its pattern tables. The NNUE networks do not see walls,
so they are not used here.

## Rebuilding

```bash
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest
source ~/emsdk/emsdk_env.sh
engine/build.sh /path/to/rapfi            # the repository that contains Rapfi/ and Networks/
```

Both builds use WebAssembly SIMD, which every current browser supports. `coi-serviceworker.js` in the
site root makes the page cross-origin isolated on hosts that cannot send COOP/COEP headers, such as
GitHub Pages.
