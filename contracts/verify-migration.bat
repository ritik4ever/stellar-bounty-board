@echo off
REM Soroban SDK Migration Verification Script (Windows)
REM This script verifies the migration from v21.7.7 to v25.3.1

echo =========================================
echo Soroban SDK Migration Verification
echo Target Version: 25.3.1
echo =========================================
echo.

REM Step 1: Update dependencies
echo Step 1: Updating Cargo.lock...
cargo update
if %ERRORLEVEL% NEQ 0 (
    echo X Cargo update failed
    exit /b 1
)
echo √ Cargo.lock updated
echo.

REM Step 2: Build project
echo Step 2: Building project...
cargo build --release > build.log 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo X Build failed
    echo Check build.log for details
    type build.log
    exit /b 1
)
echo √ Build successful (0 errors)
echo.

REM Step 3: Check for warnings
echo Step 3: Checking for warnings...
findstr /C:"warning:" build.log > nul
if %ERRORLEVEL% EQU 0 (
    echo ! Found warnings:
    findstr /C:"warning:" build.log
) else (
    echo √ No warnings found
)
echo.

REM Step 4: Run tests
echo Step 4: Running tests...
cargo test > test.log 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo X Tests failed
    echo Check test.log for details
    type test.log
    exit /b 1
)
echo √ All tests passed
echo.

REM Step 5: Verify version
echo Step 5: Verifying soroban-sdk version...
cargo tree | findstr /C:"soroban-sdk v25.3.1" > nul
if %ERRORLEVEL% EQU 0 (
    echo √ soroban-sdk version is 25.3.1
) else (
    echo X Unexpected soroban-sdk version
    cargo tree | findstr /C:"soroban-sdk"
    exit /b 1
)
echo.

echo =========================================
echo Migration Verification Complete!
echo =========================================
echo.
echo Summary:
echo   - Cargo.toml: Updated to soroban-sdk 25.3.1
echo   - Cargo.lock: Regenerated
echo   - Build: Success
echo   - Tests: All passed
echo   - Version: Confirmed 25.3.1
echo.
echo Next steps:
echo   1. Review MIGRATION_NOTES.md for details
echo   2. Commit Cargo.toml and Cargo.lock
echo   3. Consider enabling optional features
echo.
pause
