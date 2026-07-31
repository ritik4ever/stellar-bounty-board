#!/bin/bash

# Soroban SDK Migration Verification Script
# This script verifies the migration from v21.7.7 to v25.3.1

set -e

echo "========================================="
echo "Soroban SDK Migration Verification"
echo "Target Version: 25.3.1"
echo "========================================="
echo ""

# Step 1: Update dependencies
echo "Step 1: Updating Cargo.lock..."
cargo update
echo "✓ Cargo.lock updated"
echo ""

# Step 2: Check for compilation errors
echo "Step 2: Building project..."
cargo build --release 2>&1 | tee build.log
BUILD_EXIT_CODE=${PIPESTATUS[0]}

if [ $BUILD_EXIT_CODE -eq 0 ]; then
    echo "✓ Build successful (0 errors)"
else
    echo "✗ Build failed with exit code $BUILD_EXIT_CODE"
    echo "Check build.log for details"
    exit 1
fi
echo ""

# Step 3: Check for warnings
echo "Step 3: Checking for warnings..."
WARNING_COUNT=$(grep -c "warning:" build.log || true)
if [ $WARNING_COUNT -eq 0 ]; then
    echo "✓ No warnings found"
else
    echo "⚠ Found $WARNING_COUNT warning(s)"
    grep "warning:" build.log
fi
echo ""

# Step 4: Run tests
echo "Step 4: Running tests..."
cargo test 2>&1 | tee test.log
TEST_EXIT_CODE=${PIPESTATUS[0]}

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✓ All tests passed"
else
    echo "✗ Tests failed with exit code $TEST_EXIT_CODE"
    echo "Check test.log for details"
    exit 1
fi
echo ""

# Step 5: Verify soroban-sdk version
echo "Step 5: Verifying soroban-sdk version..."
INSTALLED_VERSION=$(cargo tree | grep "soroban-sdk v" | head -1 | sed 's/.*soroban-sdk v\([0-9.]*\).*/\1/')
if [ "$INSTALLED_VERSION" = "25.3.1" ]; then
    echo "✓ soroban-sdk version is 25.3.1"
else
    echo "✗ Unexpected soroban-sdk version: $INSTALLED_VERSION"
    exit 1
fi
echo ""

# Step 6: Check binary size
echo "Step 6: Checking binary size..."
WASM_FILE="target/wasm32-unknown-unknown/release/stellar_bounty_board.wasm"
if [ -f "$WASM_FILE" ]; then
    SIZE=$(wc -c < "$WASM_FILE")
    SIZE_KB=$((SIZE / 1024))
    echo "✓ Contract binary size: ${SIZE_KB}KB"
else
    echo "⚠ WASM file not found (this is OK if not building for wasm32 target)"
fi
echo ""

echo "========================================="
echo "Migration Verification Complete!"
echo "========================================="
echo ""
echo "Summary:"
echo "  - Cargo.toml: Updated to soroban-sdk 25.3.1"
echo "  - Cargo.lock: Regenerated"
echo "  - Build: Success (0 errors, $WARNING_COUNT warnings)"
echo "  - Tests: All passed"
echo "  - Version: Confirmed 25.3.1"
echo ""
echo "Next steps:"
echo "  1. Review MIGRATION_NOTES.md for details"
echo "  2. Commit Cargo.toml and Cargo.lock"
echo "  3. Consider enabling optional features (see MIGRATION_NOTES.md)"
echo ""
