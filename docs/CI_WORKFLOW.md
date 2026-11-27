# Continuous Integration Workflow Guide (`.github/workflows/ci.yml`)

This document details the architectural rationale for configuration settings and job steps defined in `.github/workflows/ci.yml`, identifying and explaining deliberate deviations from standard tool and action defaults, and providing a granular breakdown of non-obvious settings.

---

## Workflow Architecture Overview

`.github/workflows/ci.yml` orchestrates automated verification across the monorepo's three primary layers:
1. **`backend`**: Node.js/TypeScript Express API (type-check, ESLint, unit tests, coverage report artifact).
2. **`frontend`**: Next.js/React web application (type-check, ESLint, unit tests, Storybook build).
3. **`contract`**: Stellar Soroban smart contracts written in Rust (cargo-audit vulnerability scanning, release WASM build).

---

## Matrix of Deviations from Framework & Action Defaults (Issue #1424)

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

## Non-Obvious Settings Breakdown & Classification (Issue #1426)

To prevent future contributors from inadvertently modifying critical settings or retaining obsolete boilerplate out of caution, all values in `.github/workflows/ci.yml` are categorized below into **Template Boilers** (safe to adjust during upgrades) and **Deliberately Chosen Load-Bearing Values** (must not be altered without repo-wide testing):

### 1. Template vs. Deliberately Chosen Settings

| Setting Location | Config Value | Classification | Purpose & Impact if Modified |
| :--- | :--- | :--- | :--- |
| `jobs.*.runs-on` | `ubuntu-latest` | **Template Boiler** | Standard ephemeral GitHub-hosted Linux VM. Safe to change to specific Ubuntu LTS versions if runner deprecations require it. |
| `jobs.backend/frontend.steps[setup-node].node-version` | `'20'` | **Deliberately Chosen** | Pinned to Node.js 20 LTS (Iron) to maintain exact parity with container images in `Dockerfile` and production runtime engines. Changing to latest or unpinned risks runtime syntax drift. |
| `jobs.*.steps[cache].restore-keys` | `${{ runner.os }}-*-node-modules-` | **Deliberately Chosen** | Enables prefix-based cache restoration. If exact lockfile hash misses, runner restores previous build's `node_modules` and only downloads incremental delta. |
| `jobs.contract.steps[install cargo-audit].run` | `cargo install cargo-audit --version "=0.21.2" --locked` | **Deliberately Chosen** | Strict exact version `=0.21.2` plus `--locked` prevents cargo from pulling transitive dependency updates in `cargo-audit` that broke advisory schema parsing in newer releases. |
| `jobs.contract.steps[audit].run` | `cargo audit > ../contract-audit.log` | **Deliberately Chosen** | Piping stdout to a root log file decouples security report generation from the runner exit code, allowing `actions/upload-artifact` to capture the audit report for maintainer review. |
| `jobs.*.steps[upload-artifact].if` | `always()` | **Deliberately Chosen** | By default, GitHub Actions cancels subsequent artifact uploads if earlier tests fail. `always()` guarantees that test reports and audit logs are available for failed PR triage. |

---

## Contributor Safety Checklist

- [x] **Upgrading Node.js**: If updating `node-version` in `ci.yml`, you MUST simultaneously update the Dockerfile base image (`node:20-alpine`) and `package.json` `engines.node` block.
- [x] **Subpackage Scripts**: Always use `--prefix backend` or `--prefix frontend` rather than `cd backend && npm test`. This ensures working directory context remains at repo root for artifact resolution.
- [x] **Rust Toolchain**: Do NOT remove `target: wasm32-unknown-unknown`; Soroban contracts cannot build without this target.
