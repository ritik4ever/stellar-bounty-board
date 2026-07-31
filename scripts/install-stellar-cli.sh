#!/usr/bin/env bash
set -euo pipefail

# Installs the Stellar CLI binary if it is not already present on PATH.
# Used by npm run gen:bindings and CI to ensure stellar contract bindings
# typescript is available.

REQUIRED_VERSION="${STELLAR_CLI_VERSION:-27.0.0}"
INSTALL_DIR="${STELLAR_CLI_INSTALL_DIR:-$HOME/.local/bin}"

if command -v stellar >/dev/null 2>&1; then
  INSTALLED_VERSION="$(stellar --version | awk '{print $2}')"
  if [ "$INSTALLED_VERSION" = "$REQUIRED_VERSION" ]; then
    echo "stellar $INSTALLED_VERSION already installed"
    exit 0
  fi
  echo "stellar $INSTALLED_VERSION installed, but $REQUIRED_VERSION required; reinstalling"
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Map common architecture names to Stellar release names.
case "$ARCH" in
  x86_64)
    ARCH="x86_64"
    ;;
  aarch64 | arm64)
    ARCH="aarch64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET="stellar-cli-${REQUIRED_VERSION}-${ARCH}-unknown-${OS}-gnu.tar.gz"
URL="https://github.com/stellar/stellar-cli/releases/download/v${REQUIRED_VERSION}/${ASSET}"

echo "Downloading Stellar CLI from $URL"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$URL" -o "$TMP_DIR/stellar-cli.tar.gz"
tar -xzf "$TMP_DIR/stellar-cli.tar.gz" -C "$TMP_DIR"

mkdir -p "$INSTALL_DIR"
cp "$TMP_DIR/stellar" "$INSTALL_DIR/stellar"
chmod +x "$INSTALL_DIR/stellar"

echo "Installed stellar $REQUIRED_VERSION to $INSTALL_DIR/stellar"
echo "Ensure $INSTALL_DIR is on your PATH."
