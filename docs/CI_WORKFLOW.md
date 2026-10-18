# Continuous Integration Workflow Guide (`.github/workflows/ci.yml`)

This document details the architectural rationale for configuration settings and job steps defined in `.github/workflows/ci.yml`, identifying and explaining deliberate deviations from standard tool and action defaults.

---

## Workflow Architecture Overview

`.github/workflows/ci.yml` orchestrates automated verification across the monorepo's three primary layers:
1. **`backend`**: Node.js/TypeScript Express API (type-check, ESLint, unit tests, coverage report artifact).
2. **`frontend`**: Next.js/React web application (type-check, ESLint, unit tests, Storybook build).
3. **`contract`**: Stellar Soroban smart contracts written in Rust (cargo-audit vulnerability scanning, release WASM build).

---

## Matrix of Deviations from Framework & Action Defaults

| Setting / Action Step | Framework / Action Default | Deliberate Deviation in `ci.yml` | Rationale & Load-Bearing Context |
| :--- | :--- | :--- | :--- |
| **`actions/setup-node` `cache-dependency-path`** | Looks only for root `package-lock.json` | Explicitly lists both root `package-lock.json` and subpackage lockfiles (`backend/package-lock.json` or `frontend/package-lock.json`) | In this decoupled monorepo, subpackage dependencies can change independently without bumping the root lockfile. Dual path tracking ensures accurate cache invalidation. |
| **Node.js Modules Caching (`actions/cache`)** | Caches global `~/.npm` download tarballs | Directly caches root `node_modules` and subpackage `node_modules` (`backend/node_modules`, `frontend/node_modules`) | Eliminates CPU-intensive npm archive extraction and link resolution on every CI runner initialization, reducing step duration by ~45%. |
| **Dependency Installation** | `npm install` for interactive environments | `npm ci` with `--prefix <subpackage>` | Enforces strict fidelity to committed lockfiles. Rejects non-deterministic dependency upgrades and fails fast if lockfiles drift from `package.json`. |
| **Coverage Artifact Upload Condition** | `if: success()` (default upload behavior) | `if: always()` on `actions/upload-artifact@v4` | Uploads coverage reports and test failure traces even when the test suite fails, providing contributors with diagnostic logs for debugging regressions. |
| **Rust Toolchain Target (`actions-rust-lang/setup-rust-toolchain`)** | Compiles to native host runner architecture (`x86_64-unknown-linux-gnu`) | Explicit `target: wasm32-unknown-unknown` | Soroban smart contracts execute in the Stellar network WebAssembly VM. The `wasm32-unknown-unknown` target is mandatory to generate valid `.wasm` bytecode. |
| **Security Audit Tool Pinning (`cargo-audit`)** | Unpinned `cargo install cargo-audit` pulling latest release from crates.io | Explicitly pinned to `--version "=0.21.2" --locked` | Prevents breaking CLI argument adjustments or upstream advisory database parser changes from breaking CI builds unpredictably. |
| **Soroban Contract Compilation Mode** | `cargo build` in debug unoptimized mode | `cargo build --target wasm32-unknown-unknown --release` | Debug contract builds exceed Stellar VM size limitations and gas consumption ceilings. The `--release` flag applies bytecode optimization and dead code elimination. |

---

## Non-Obvious Settings & Contributor Guidance

1. **Decoupled Monorepo Structure**: Never remove the `--prefix` flag from backend or frontend test steps. The monorepo uses independent package roots rather than npm workspaces to maintain strict separation of deployment concerns.
2. **Deterministic Artifact Naming**: Artifact names `backend-coverage` and `contract-audit` are referenced by downstream deployment and compliance checkers. Do not rename them without updating dependent pipelines.
3. **Rust Toolchain Versioning**: Soroban SDK releases are tightly coupled to specific Rust compiler editions and target intrinsics. Deviations in target configuration will cause contract deployment failures on testnet.
