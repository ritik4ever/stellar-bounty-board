# Lint-Staged Configuration Guide (`.lintstagedrc.json`)

This document provides architectural context for the rules defined in `.lintstagedrc.json`, distinguishing deliberate repository-specific configurations from standard framework defaults.

## Overview of Rules

```json
{
  "frontend/src/**/*.{ts,tsx}": ["prettier --write"],
  "*.{json,md,yaml,yml}": ["prettier --write"],
  ".coderabbit.yaml": ["prettier --write"],
  "*.sol": ["forge fmt"],
  "*.rs": ["rustfmt"]
}
```

---

## Detailed Rationale & Distinction Matrix

| Setting / Pattern            | Classification          | Architectural Rationale & Non-Obvious Behavior                                                                                                                                                                                                                                                                                                     |
| :--------------------------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/**/*.{ts,tsx}` | **Deliberately Chosen** | Standard lint-staged templates format all `**/*.{ts,tsx}` indiscriminately. In this monorepo, backend TypeScript compilation occurs under strict isolated tsconfig paths (`backend/`). Scoping Prettier checks explicitly prevents pre-commit performance degradation across generated types or mock fixtures outside frontend source directories. |
| `*.{json,md,yaml,yml}`       | **Template Default**    | Enforces consistent formatting across root-level documentation (`README.md`, `CONTRIBUTING.md`), project manifests (`package.json`), and CI/Docker workflow definitions.                                                                                                                                                                           |
| `.coderabbit.yaml`           | **Deliberately Chosen** | Standard glob matchers (`*.yaml`) do not match dotfiles by default in minimatch/glob implementations. Explicitly tracking `.coderabbit.yaml` ensures automated AI review configuration stays properly formatted and linted prior to commit.                                                                                                        |
| `*.sol`                      | **Deliberately Chosen** | Uses Foundry's `forge fmt` for any EVM-compatible contracts or interface templates present in the codebase. Distinguishes smart contract formatting from standard JavaScript/TypeScript linters.                                                                                                                                                   |
| `*.rs`                       | **Deliberately Chosen** | Invokes standard `rustfmt` on Rust files. This is essential for the Soroban smart contracts located under `contracts/`, ensuring Rust code adheres to official community style conventions without needing manual cargo commands before committing.                                                                                                |

---

## Modifying This Configuration

When introducing new languages, linters, or workspace packages to this repository:

1. Verify whether the formatter operates in-place (e.g. `prettier --write`, `rustfmt`, `forge fmt`).
2. Avoid running linters that produce non-fixable warnings on staged files unless automated autofixing (`--fix`) is available, to avoid blocking fast git commits.
3. Keep glob patterns scoped to relevant source trees to minimize hook execution latency.
