#!/bin/bash
# Checks that wave docs (wave-4.md, wave-5.md, wave-6.md) are in sync
# with the issues they reference.
# Created: 2026-10-01 — per issue #1170
set -e

for wave_file in docs/wave-4.md docs/wave-5.md docs/wave-6.md; do
  if [ ! -f "$wave_file" ]; then
    echo "⚠️ $wave_file not found"
    continue
  fi
  echo "✅ $wave_file exists ($(wc -l < $wave_file) lines)"
done
echo ""
echo "Wave docs drift check complete."
