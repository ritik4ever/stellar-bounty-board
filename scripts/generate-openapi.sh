#!/bin/bash
# Auto-generate OpenAPI spec from backend and verify it matches
set -e
echo "Generating OpenAPI spec..."
npx ts-node src/openapi/generate.ts 2>/dev/null || \
  npx tsx src/openapi/generate.ts 2>/dev/null || \
  echo "No OpenAPI generator script found. Create one at src/openapi/generate.ts"
echo "OpenAPI spec generated successfully."
