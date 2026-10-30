#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PATCHED=false
for f in contracts/src/lib.rs; do
  if ! [ -f "$f" ]; then
    echo "patch_guard: missing $f" >&2
    exit 1
  fi
  # Normalize line endings
  norm=$(tr -d '\r' < "$f")
  # Build the target contents by injecting the uniqueness guard into create_bounty
  target=$(python3 - <<'PY'
import re, sys
p = "contracts/src/lib.rs"
s = open(p, encoding="utf-8").read()
s = re.sub(
    r"(\n\s*\.checked_add\(1\)\n\s*\.unwrap_or_else\(\|\| panic_error\(&env, ContractError::BountyIdOverflow\)\);)\n(\s*if env\n\s*\.storage\(\)\n\s*\.persistent\(\)\n\s*\.has\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\)\)\n\s*\{\n\s*panic_error\(&env, ContractError::DuplicateBountyRepoIssuePair\);\n\s*\}\n)",
    r"\1\n\2",
    s,
)
s = re.sub(
    r"(\n\s*\.checked_add\(1\)\n\s*\.unwrap_or_else\(\|\| panic_error\(&env, ContractError::BountyIdOverflow\);)",
    r"\1\n\n        if env\n            .storage()\n            .persistent()\n            .has(&DataKey::BountyExists(repo.clone(), issue_number))\n        {\n            panic_error(&env, ContractError::DuplicateBountyRepoIssuePair);\n        }\n",
    s,
    count=1,
)
s = re.sub(
    r"(\n\s*let bounty = Bounty \{)\n(\s*maintainer: maintainer\.clone\(\),)",
    r"\1\n\2",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyExists\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
s = re.sub(
    r"(\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::Bounty\(next_id\), &bounty\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyMaintainer\(repo\.clone\(\), issue_number\), &maintainer\);\n\s*env\.storage\(\)\n\s*\.persistent\(\)\n\s*\.set\(&DataKey::BountyRepoIssue\(repo\.clone\(\), issue_number\), &next_id\);\n)",
    r"\1",
    s,
)
if s == open(p, encoding="utf-8").read():
    print("NOOP")
else:
    open(p, "w", encoding="utf-8").write(s)
    print("PATCHED")
PY
)
  if [ "$target" = "PATCHED" ]; then
    PATCHED=true
  fi
done

rm -f contracts/patch_guard.rs contracts/src/patch_guard.rs

if [ "$PATCHED" = true ]; then
  echo "patch_guard: patched contracts/src/lib.rs"
else
  echo "patch_guard: no changes required" >&2
fi
