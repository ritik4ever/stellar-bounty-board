# ESLint Configuration Guide (`.eslintrc.json`)

This document details the architectural rationale for rules defined in `.eslintrc.json`, identifying and explaining deliberate deviations from standard ESLint and TypeScript recommended defaults.

---

## Configuration Overview

```json
{
  "root": true,
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "import/no-unresolved": "error",
    "import/extensions": [
      "error",
      "ignorePackages",
      {
        "js": "never",
        "jsx": "never",
        "ts": "never",
        "tsx": "never"
      }
    ]
  },
  "overrides": [
    {
      "files": ["backend/src/**/*.ts", "frontend/src/**/*.{ts,tsx}"],
      "rules": {
        "no-console": ["error", { "allow": ["warn", "error"] }]
      }
    },
    {
      "files": [
        "backend/test/**/*.ts",
        "frontend/src/**/*.test.ts",
        "frontend/src/**/*.test.tsx",
        "frontend/src/**/*.stories.tsx"
      ],
      "rules": {
        "no-console": "off"
      }
    }
  ]
}
```

---

## Matrix of Deviations from Framework Defaults

| Setting / Rule                       | Framework / Recommended Default                  | Deliberate Deviation                        | Rationale & Load-Bearing Context                                                                                                                            |
| :----------------------------------- | :----------------------------------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root: true`                         | `false`                                          | `true`                                      | Prevents ESLint from traversing parent directories outside this repository tree when executed on developer workstations or CI environments.                 |
| `@typescript-eslint/no-unused-vars`  | `"error"`                                        | `"warn"`                                    | Prevents blocking developers during iterative prototyping and test writing. Elevated to strict review enforcement in CI release branches.                   |
| `@typescript-eslint/no-explicit-any` | `"warn"`                                         | `"error"`                                   | High-stakes Web3 and Stellar Soroban interactions require strict type guarantees. Banning `any` forces typed interfaces on transaction and bounty payloads. |
| `import/extensions`                  | Disallow or enforce `.js` (ESM default)          | `never` for `.js, .jsx, .ts, .tsx`          | Frontend uses Vite/Next.js and backend uses TypeScript module resolution with path aliases. Extensionless imports ensure cross-workspace portability.       |
| `no-console` (Source files)          | `"off"` (ESLint recommended) or strict `"error"` | `["error", { "allow": ["warn", "error"] }]` | Bar naked `console.log` statements in production bundles while allowing structured diagnostic errors and warnings before loggers are initialized.           |
| `no-console` (Tests & Stories)       | Inherited from base rules                        | `"off"`                                     | Unit tests and Storybook components need stdout logging for diagnostic assertions and lifecycle demonstration.                                              |

---

## Upgrade & Modification Guidelines

When updating ESLint or `@typescript-eslint`:

1. Do not revert `import/extensions: never`; doing so will break bundler module resolution across workspaces.
2. Keep `@typescript-eslint/no-explicit-any: error` active to preserve Stellar transaction type integrity.
