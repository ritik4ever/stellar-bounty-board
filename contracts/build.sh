#!/usr/bin/env bash
set -euo pipefail

TARGET="wasm32v1-none"
TARGET_DIR="target/$TARGET/release"
WASM_FILE="$TARGET_DIR/stellar_bounty_board.wasm"
BENCHMARKS_FILE="BENCHMARKS.md"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed or not in PATH." >&2
    exit 1
  fi
}

measure_size() {
  wc -c < "$1" | tr -d ' '
}

require_command cargo
require_command wasm-opt

rustup target add "$TARGET" >/dev/null 2>&1 || true

cargo test --all --verbose
cargo build --release --target "$TARGET"

if [ ! -f "$WASM_FILE" ]; then
  echo "Error: expected WASM artifact not found at $WASM_FILE" >&2
  exit 1
fi

BEFORE_SIZE=$(measure_size "$WASM_FILE")
wasm-opt -Oz "$WASM_FILE" -o "$WASM_FILE"
AFTER_SIZE=$(measure_size "$WASM_FILE")

cat > "$BENCHMARKS_FILE" <<EOF
# Contract WASM benchmarks

| Artifact | Size (bytes) |
| --- | ---: |
| Before \`wasm-opt -Oz\` | $BEFORE_SIZE |
| After \`wasm-opt -Oz\` | $AFTER_SIZE |

## Reproduction

Run the optimized release build from the \`contracts/\` directory:

\`\`\`bash
./build.sh
\`\`\`

This script performs:

1. \`cargo test --all --verbose\`
2. \`cargo build --release --target wasm32v1-none\`
3. \`wasm-opt -Oz\` on \`target/wasm32v1-none/release/stellar_bounty_board.wasm\`
4. updates this benchmark file with the measured sizes
EOF

echo "WASM optimized successfully"
echo "Before: $BEFORE_SIZE bytes"
echo "After:  $AFTER_SIZE bytes"
echo "Benchmark report updated at $BENCHMARKS_FILE"