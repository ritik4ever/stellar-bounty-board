#!/usr/bin/env bash
set -euo pipefail

# Regenerates TypeScript bindings from the Soroban contract ABI and writes them
# to frontend/src/generated/.
#
# Usage:
#   npm run gen:bindings
#
# The script expects the Stellar CLI (stellar) to be available. If it is not,
# it will download a prebuilt binary automatically.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
FRONTEND_DIR="$ROOT_DIR/frontend"
OUTPUT_DIR="$FRONTEND_DIR/src/generated"
WASM_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"

# Ensure stellar CLI is available.
if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI not found. Installing..."
  bash "$ROOT_DIR/scripts/install-stellar-cli.sh"
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "Building Soroban contract WASM..."
(
  cd "$CONTRACTS_DIR"
  cargo build --release --target wasm32-unknown-unknown
)

WASM_FILE="$(ls "$WASM_DIR"/*.wasm | head -n 1)"
if [ -z "$WASM_FILE" ]; then
  echo "WASM file not found in $WASM_DIR" >&2
  exit 1
fi

echo "Generating TypeScript bindings from $WASM_FILE..."
rm -rf "$OUTPUT_DIR"
stellar contract bindings typescript \
  --wasm "$WASM_FILE" \
  --output-dir "$OUTPUT_DIR" \
  --overwrite

echo "Bindings generated in $OUTPUT_DIR"
