# Contract Bindings Drift Workflow Guide (`.github/workflows/bindings-drift.yml`)

This document verifies and details the operational alignment between `.github/workflows/bindings-drift.yml` and the actual build, scripting, and runtime requirements of the application (Issue #1428).

---

## Workflow Purpose & Architecture

The `bindings-drift.yml` workflow guarantees that the generated TypeScript contract interfaces located in `frontend/src/generated/` remain strictly synchronous with the Soroban Rust smart contract implementation in `contracts/`. If a contributor modifies the contract data structures, events, or callable methods without running `npm run gen:bindings`, this workflow fails in CI before stale bindings can reach staging or production.

---

## Comprehensive Entry-by-Entry Verification Against Actual Usage

Every directive and step in `.github/workflows/bindings-drift.yml` has been verified against the underlying source code and package scripts:

| Workflow Directive | Configured Value in `bindings-drift.yml` | Verified Source Match in Repository | Verification Status & Load-Bearing Context |
| :--- | :--- | :--- | :--- |
| **Runner OS** | `runs-on: ubuntu-latest` | GitHub standard Linux runner | **VERIFIED MATCH**: Binary installer `scripts/install-stellar-cli.sh` explicitly supports Linux `x86_64` GNU assets (`unknown-linux-gnu.tar.gz`). |
| **Node.js Runtime** | `node-version: "20"` | `package.json` engines, `Dockerfile` (`node:20-alpine`) | **VERIFIED MATCH**: Consistent LTS runtime across CI, container images, and developer toolchains. |
| **Cache Dependency Paths** | `package-lock.json`, `frontend/package-lock.json` | Monorepo decoupled root and frontend locks | **VERIFIED MATCH**: The generated bindings are written exclusively into `frontend/src/generated`, so tracking root and frontend lockfiles ensures precise caching without unnecessary backend cache invalidation. |
| **Rust Toolchain Target** | `target: wasm32-unknown-unknown` | `contracts/Cargo.toml`, `scripts/gen-bindings.sh` | **VERIFIED MATCH**: Soroban smart contracts require compilation to `wasm32-unknown-unknown` before `stellar contract bindings typescript` can introspect the WASM ABI. |
| **Cargo Cache Keys** | `~/.cargo/registry`, `~/.cargo/git`, `contracts/target` | `Cargo.lock` hashing | **VERIFIED MATCH**: Caches Rust compiler artifacts across CI runs to avoid recompiling soroban-sdk dependencies. |
| **CLI Installation Script** | `bash scripts/install-stellar-cli.sh` | File `scripts/install-stellar-cli.sh` | **VERIFIED MATCH**: Script exists, is executable, and downloads Stellar CLI version 27.0.0 directly into `$HOME/.local/bin`. |
| **CLI PATH Export** | `export PATH="$HOME/.local/bin:$PATH"` | `scripts/install-stellar-cli.sh` (`INSTALL_DIR`) | **VERIFIED MATCH**: Matches the default binary installation directory used by `install-stellar-cli.sh`. |
| **Bindings Generator Script** | `npm run gen:bindings` | `package.json` `"gen:bindings": "bash scripts/gen-bindings.sh"` | **VERIFIED MATCH**: Executes the canonical project bindings generator which compiles WASM and invokes `stellar contract bindings typescript`. |
| **Output Diff Target** | `frontend/src/generated` | `frontend/src/` import consumers | **VERIFIED MATCH**: Application components import contract bindings directly from `@/generated`. Running `git diff --exit-code frontend/src/generated` cleanly catches any ABI changes. |

---

## Intentional Differences from Default Action Scaffolds

1. **Dual Lockfile Caching**: Unlike generic single-package templates, `cache-dependency-path` explicitly tracks `frontend/package-lock.json` in addition to `package-lock.json` because frontend dependencies govern the TypeScript compiler and bindings consumers.
2. **Deterministic PATH Resolution**: The workflow explicitly prepends `$HOME/.local/bin` to `PATH` before invoking `npm run gen:bindings`, guaranteeing that the newly installed Stellar CLI binary takes precedence over any stale system binaries.
