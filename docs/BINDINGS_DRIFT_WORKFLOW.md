# Contract Bindings Drift Workflow Guide (`.github/workflows/bindings-drift.yml`)

This document verifies and details the operational alignment between `.github/workflows/bindings-drift.yml` and the actual build, scripting, and runtime requirements of the application (Issue #1428), and provides an architectural breakdown of non-obvious workflow settings (Issue #1429).

---

## Workflow Purpose & Architecture

The `bindings-drift.yml` workflow guarantees that the generated TypeScript contract interfaces located in `frontend/src/generated/` remain strictly synchronous with the Soroban Rust smart contract implementation in `contracts/`. If a contributor modifies the contract data structures, events, or callable methods without running `npm run gen:bindings`, this workflow fails in CI before stale bindings can reach staging or production.

---

## Comprehensive Entry-by-Entry Verification Against Actual Usage (Issue #1428)

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

## Non-Obvious Settings Breakdown & Classification (Issue #1429)

To ensure contributors understand the intent of each configuration value and avoid breaking load-bearing mechanics, settings are categorized into **Template Boilers** and **Deliberately Chosen Load-Bearing Values**:

| Setting Location | Config Value | Classification | Purpose & Impact if Modified |
| :--- | :--- | :--- | :--- |
| `name` | `Contract Bindings Drift` | **Template Boiler** | Human-readable workflow display name in GitHub Actions UI. Safe to rephrase. |
| `on` | `pull_request` & `push` on `main` | **Deliberately Chosen** | Dual event trigger ensures PRs are validated pre-merge and post-merge pushes to `main` are checked in case direct merges bypassed branch protection. |
| `jobs.bindings-drift.steps[Rust].target` | `wasm32-unknown-unknown` | **Deliberately Chosen** | Non-obvious compiler target; native host targets (`x86_64`) will cause `stellar contract bindings typescript` to fail with invalid ELF format errors. |
| `jobs.bindings-drift.steps[Regenerate].run` | `export PATH="$HOME/.local/bin:$PATH"` | **Deliberately Chosen** | Prepends local user bin to PATH. Essential because standard GitHub Actions runners do not include `$HOME/.local/bin` in default runner PATH. |
| `jobs.bindings-drift.steps[Diff].run` | `git diff --exit-code frontend/src/generated` | **Deliberately Chosen** | Standard `git diff` exits with 0 even when differences exist. The non-obvious `--exit-code` flag forces non-zero exit code if bindings drifted. |
| `jobs.bindings-drift.steps[Diff].run` | `echo "::error::..."` | **Deliberately Chosen** | Emits GitHub Actions workflow command syntax to highlight error inline on the PR files changed view with actionable remediation guidance. |

---

## Contributor Remediation Protocol

If the `Contract Bindings Drift` check fails on your PR:
1. Ensure your local branch is rebased on latest `main`.
2. Run `npm run gen:bindings` locally from repo root.
3. Commit the updated files in `frontend/src/generated/` and push to your PR branch.
