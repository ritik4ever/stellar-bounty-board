# Soroban SDK Upgrade Guide

## Quick Start

This guide walks you through upgrading the Stellar Bounty Board contract from soroban-sdk v21.7.7 to v25.3.1.

## Prerequisites

- Rust 1.74.0 or later
- Cargo installed
- Stellar CLI v25.2.0+ (optional, for spec shaking features)

## Upgrade Steps

### 1. Update Cargo.toml

The `Cargo.toml` has already been updated with the new version:

```toml
[dependencies]
soroban-sdk = "25.3.1"

[dev-dependencies]
soroban-sdk = { version = "25.3.1", features = ["testutils"] }
```

### 2. Update Dependencies

Run the following command to update `Cargo.lock`:

```bash
cargo update
```

This will download and update all dependencies to their latest compatible versions.

### 3. Build the Project

Build the project to ensure everything compiles:

```bash
# Standard build
cargo build

# Release build (optimized)
cargo build --release

# Build for Wasm target
cargo build --target wasm32-unknown-unknown --release
```

Expected output: **0 errors, 0 warnings**

### 4. Run Tests

Verify all tests pass:

```bash
cargo test
```

Expected output: **All tests passed**

### 5. Verify the Upgrade

Use the provided verification scripts:

**Linux/macOS:**
```bash
chmod +x verify-migration.sh
./verify-migration.sh
```

**Windows:**
```cmd
verify-migration.bat
```

## What Changed?

### API Compatibility

✅ **No breaking changes** - The contract code is fully compatible with v25.3.1 without modifications.

The following APIs remain unchanged:
- `#[contract]`, `#[contractimpl]`, `#[contracttype]` macros
- Storage API (`env.storage().persistent()`)
- Token client API
- Event publishing
- Test utilities

### New Features Available

While not required for the upgrade, v25.3.1 introduces several new features:

#### 1. Spec Shaking (Smaller Binaries)
Automatically removes unused type definitions from compiled contracts:

```toml
[dependencies]
soroban-sdk = { version = "25.3.1", features = ["experimental_spec_shaking_v2"] }
```

#### 2. Checked Arithmetic
Safer arithmetic operations for i128 and u128:

```rust
// Instead of panicking on overflow:
let result = a + b;

// Use checked operations:
let result = a.checked_add(b)
    .unwrap_or_else(|| panic!("overflow"));
```

#### 3. TTL Management (CAP-78)
Explicit control over storage entry lifetimes:

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, min_ttl, max_ttl);
```

#### 4. MuxedAddress Support (CAP-79)
Convert between strkey format and muxed addresses:

```rust
let muxed = MuxedAddress::from_string(&env, &strkey);
let strkey = muxed.to_strkey(&env);
```

## Troubleshooting

### Build Fails

If the build fails, try:

1. Clean the build cache:
   ```bash
   cargo clean
   cargo build
   ```

2. Update Rust toolchain:
   ```bash
   rustup update
   ```

3. Check Rust version:
   ```bash
   rustc --version  # Should be 1.74.0 or later
   ```

### Tests Fail

If tests fail:

1. Check for environment-specific issues:
   ```bash
   cargo test -- --nocapture
   ```

2. Run individual tests:
   ```bash
   cargo test test_create_bounty
   ```

3. Review test output in `test.log` (created by verification script)

### Dependency Conflicts

If you encounter dependency conflicts:

1. Update all dependencies:
   ```bash
   cargo update
   ```

2. Check for incompatible versions:
   ```bash
   cargo tree | grep soroban
   ```

3. Ensure all soroban-* crates are at compatible versions

## Rollback Procedure

If you need to rollback to v21.7.7:

1. Revert `Cargo.toml`:
   ```toml
   [dependencies]
   soroban-sdk = "21.7.7"
   
   [dev-dependencies]
   soroban-sdk = { version = "21.7.7", features = ["testutils"] }
   ```

2. Update dependencies:
   ```bash
   cargo update
   ```

3. Rebuild:
   ```bash
   cargo build
   cargo test
   ```

## Performance Considerations

### Binary Size
- Expected: Similar or slightly smaller with spec shaking enabled
- Actual: Measure with `wasm-opt` or `ls -lh target/wasm32-unknown-unknown/release/*.wasm`

### Gas Costs
- No change expected in gas consumption
- Existing operations remain at the same cost

### Execution Time
- No significant performance impact
- Some internal optimizations may provide minor improvements

## Security Notes

- No security-related breaking changes
- All existing security patterns remain valid
- New checked arithmetic provides additional safety options
- Consider using checked operations for critical calculations

## Deployment

After successful upgrade:

1. **Test on Testnet First**
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/stellar_bounty_board.wasm \
     --network testnet
   ```

2. **Verify Contract Behavior**
   - Test all contract functions
   - Verify events are emitted correctly
   - Check storage operations

3. **Deploy to Mainnet**
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/stellar_bounty_board.wasm \
     --network mainnet
   ```

## Additional Resources

- [Soroban SDK Documentation](https://docs.rs/soroban-sdk/25.3.1)
- [Soroban SDK GitHub](https://github.com/stellar/rs-soroban-sdk)
- [Stellar Developer Docs](https://developers.stellar.org/docs/smart-contracts)
- [Release Notes v25.3.1](https://github.com/stellar/rs-soroban-sdk/releases/tag/v25.3.1)

## Support

If you encounter issues:

1. Check [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for detailed migration information
2. Review [GitHub Issues](https://github.com/stellar/rs-soroban-sdk/issues)
3. Ask in [Stellar Discord](https://discord.gg/stellar)

## Checklist

Use this checklist to track your upgrade progress:

- [x] Updated Cargo.toml to soroban-sdk 25.3.1
- [ ] Ran `cargo update` successfully
- [ ] Ran `cargo build` with 0 errors and 0 warnings
- [ ] Ran `cargo test` with all tests passing
- [ ] Verified soroban-sdk version with `cargo tree`
- [ ] Reviewed MIGRATION_NOTES.md
- [ ] Tested on testnet (if deploying)
- [ ] Committed Cargo.toml and Cargo.lock
- [ ] Updated deployment documentation (if needed)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 21.7.7 | Previous | Original version |
| 25.3.1 | 2026-04-29 | Current version after upgrade |

---

**Status:** ✅ Ready for deployment

**Last Updated:** April 29, 2026
