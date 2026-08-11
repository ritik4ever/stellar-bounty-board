#!/bin/bash
# Import wave-5 issues from docs/issues/*.md
# Usage: ./scripts/import-wave5-issues.sh

set -e

ISSUES_DIR="docs/issues"
if [ ! -d "$ISSUES_DIR" ]; then
  echo "No docs/issues/ directory found. Create markdown files first."
  exit 1
fi

for file in "$ISSUES_DIR"/*.md; do
  title=$(head -1 "$file" | sed 's/^# //')
  body=$(tail -n +3 "$file")
  echo "Creating issue: $title"
  gh issue create --title "$title" --body "$body" 2>/dev/null || echo "Failed to create: $title"
done

echo "Import complete."
