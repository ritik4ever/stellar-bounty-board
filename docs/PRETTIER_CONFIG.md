# Prettier Configuration Guide (`.prettierrc.json`)

This document provides architectural context for the formatting rules defined in `.prettierrc.json`, identifying and explaining deliberate deviations from Prettier's default options.

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

## Upgrade & Maintenance Guidelines

When upgrading Prettier versions:

- Do not revert `trailingComma: "es5"` to `"all"` without verifying that all code generators and downstream tooling support trailing function parameter commas.
- Do not revert `printWidth: 100` to `80`, as doing so would cause mass reformatting across hundreds of source files.
