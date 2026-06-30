# Contract WASM benchmarks

| Artifact              | Size (bytes) |
| --------------------- | -----------: |
| Before `wasm-opt -Oz` |        10705 |
| After `wasm-opt -Oz`  |        10705 |

## Reproduction

Run the optimized release build from the `contracts/` directory:

```bash
./build.sh
```

This script performs:

1. `cargo test --all --verbose`
2. `cargo build --release --target wasm32v1-none`
3. `wasm-opt -Oz` on `target/wasm32v1-none/release/stellar_bounty_board.wasm`
4. updates this benchmark file with the measured sizes
