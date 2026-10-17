# Prettier Configuration Guide (`.prettierrc.json`)

This document provides architectural context for the formatting rules defined in `.prettierrc.json`, identifying and explaining deliberate deviations from Prettier's default options and confirming compatibility across the monorepo.

---

## Configuration Overview

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

---

## Matrix of Deviations from Tool Defaults

| Setting         | Prettier Default            | Project Configuration      | Classification           | Architectural Rationale & Load-Bearing Context                                                                                                                                                                                                                                             |
| :-------------- | :-------------------------- | :------------------------- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `printWidth`    | `80`                        | `100`                      | **Deliberate Deviation** | An 80-column limit causes excessive vertical wrapping in modern TypeScript codebases with long generic parameters, complex type unions, and multi-prop React components. 100 columns optimizes readability on modern widescreen displays without making side-by-side git diffs cumbersome. |
| `singleQuote`   | `false` (Double quotes `"`) | `true` (Single quotes `'`) | **Deliberate Deviation** | Standardizes on single quotes across JavaScript and TypeScript codebases. Double quotes are reserved for HTML/JSX attributes and JSON files, improving syntactic clarity.                                                                                                                  |
| `trailingComma` | `"all"` (in Prettier v3)    | `"es5"`                    | **Deliberate Deviation** | Restricts trailing commas to ES5 valid locations (objects and arrays), omitting trailing commas on function call arguments and type parameters. This maintains parser and transpiler compatibility across diverse tooling pipelines.                                                       |
| `endOfLine`     | `"lf"` (Unix) / `"auto"`    | `"lf"`                     | **Deliberate Deviation** | Forces line feed (`\n`) line endings regardless of developer operating system. Prevents Windows contributors from introducing CRLF churn into git blame histories.                                                                                                                         |
| `semi`          | `true`                      | `true`                     | **Template Default**     | Standard explicit semicolons to avoid automatic semicolon insertion (ASI) edge cases in JavaScript engines.                                                                                                                                                                                |
| `tabWidth`      | `2`                         | `2`                        | **Template Default**     | Industry standard 2-space indentation for web applications.                                                                                                                                                                                                                                |
| `useTabs`       | `false`                     | `false`                    | **Template Default**     | Standard space-based indentation for cross-platform rendering uniformity.                                                                                                                                                                                                                  |
| `arrowParens`   | `"always"`                  | `"always"`                 | **Template Default**     | Always includes parens around arrow function arguments (`(x) => x`), simplifying type annotations and argument additions.                                                                                                                                                                  |

---

## Cross-Check & Codebase Verification Audit

Every setting in `.prettierrc.json` has been cross-checked against the codebase's actual tooling and runtime requirements:

1. **Alignment with ESLint (`.eslintrc.json`)**:
   - `singleQuote: true`: Aligns with ESLint quote rules in `frontend/` and `backend/`.
   - `semi: true`: Conforms with backend and frontend TypeScript parser configurations.
2. **Alignment with Frontend Vite & React Components**:
   - `printWidth: 100`: Allows multi-prop React JSX tags to fit neatly on single lines or cleanly formatted blocks without awkward wrapping.
3. **Alignment with TypeScript Compiler (`tsconfig.json`)**:
   - `trailingComma: "es5"`: Ensures compiled TypeScript output conforms to ES5 target outputs without introducing unsupported trailing syntax in legacy Node environments.
4. **Git Pre-Commit Hook Integration (`.lintstagedrc.json`)**:
   - Verified that `npx prettier --check` and `prettier --write` run cleanly on all staged files matching `frontend/src/**/*.{ts,tsx}` and `*.{json,md,yaml,yml}`.

---

## Upgrade & Maintenance Guidelines

When upgrading Prettier versions:

- Do not revert `trailingComma: "es5"` to `"all"` without verifying that all code generators and downstream tooling support trailing function parameter commas.
- Do not revert `printWidth: 100` to `80`, as doing so would cause mass reformatting across hundreds of source files.

---

## `.prettierignore` Deviations from Framework Defaults (Issue #1440)

Prettier's default behavior only ignores `node_modules` and version control directories (`.git`). This repository deliberately extends the ignore policy for monorepo-specific and smart-contract architectural requirements:

| Ignored Path / Pattern               | Classification           | Architectural Rationale & Framework Default Difference                                                                                                                                                           |
| :----------------------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/generated`             | **Deliberate Deviation** | Auto-generated Soroban smart contract TypeScript bindings produced via `bash scripts/gen-bindings.sh`. Reformatting generated files causes `npm run check:bindings` to fail in CI due to git diff discrepancies. |
| `contracts/target`, `target`         | **Deliberate Deviation** | Rust/Cargo compiler output for Soroban WASM smart contracts. Standard JavaScript framework scaffolds do not account for compiled Rust targets in monorepo structures.                                            |
| `contracts/test_snapshots/**`        | **Deliberate Deviation** | Verbatim test snapshot fixtures from Soroban Rust test suites. Modifying snapshot JSON formatting causes regression test assertion failures.                                                                     |
| `data/*.json`, `backend/data/*.json` | **Deliberate Deviation** | Runtime JSON database files mutated dynamically by backend endpoints. Excluding them prevents runtime data churn from polluting git commits.                                                                     |
| `*.zip`, `.cache`, `.temp`, `tmp`    | **Deliberate Deviation** | Binary deliverables (e.g. `crowdpay.zip`, `stellar-bounty-board.zip`) and compiler intermediate caches that must not be parsed as text.                                                                          |
| `.nyc_output`, `coverage`            | **Deliberate Deviation** | Machine-generated test coverage metrics from Vitest/c8. Framework defaults do not exclude all test runner variants.                                                                                              |
| `.env`, `.env.local`, `.env.*.local` | **Security Sensitive**   | Secret keyrings and local environment overrides must never be altered or exposed by automated linters.                                                                                                           |
