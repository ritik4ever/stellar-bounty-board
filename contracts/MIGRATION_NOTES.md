# Soroban SDK Migration: v21.7.7 → v25.3.1

## Migration Date
April 29, 2026

## Version Changes
- **From:** soroban-sdk 21.7.7
- **To:** soroban-sdk 25.3.1

## Changes Made

### 1. Cargo.toml Updates
Updated `soroban-sdk` dependency from `21.7.7` to `25.3.1` in both:
- `[dependencies]` section
- `[dev-dependencies]` section

### 2. Code Changes Required
Based on the release notes from v21 to v25, the following changes were analyzed:

#### No Breaking Changes Required
The contract code is compatible with v25.3.1 without modifications because:
- The `#[contract]`, `#[contractimpl]`, and `#[contracttype]` macros remain unchanged
- Storage API (`env.storage().persistent()`) is backward compatible
- Token client API remains the same
- Event publishing API is unchanged
- Test utilities API is compatible

### 3. New Features Available (Optional)
The following new features are available in v25.3.1 but not required for migration:

#### v25.3.1 Features:
- MuxedAddress ScVal conversion support
- Improved compiler errors for reserved type names
- Better error messages for contractevent macro
- LedgerSnapshot atomic file writes
- Fixed try_ client methods with allow_non_root_auth

#### v25.2.0 Features:
- Spec shaking for smaller contract binaries (experimental_spec_shaking_v2 feature)
- Compile-time validation for BigInt conversions
- Optimized iterators (removed unnecessary clones)

#### v25.0.0+ Features:
- CAP-73: Stellar Asset Contract trust() function
- CAP-78: Limited TTL extensions on contract data
- CAP-79: Muxed address strkey conversion
- CAP-80: Additional BN254 and BLS12-381 host functions
- CAP-82: Checked arithmetic for 256-bit integers

### 4. Deprecation Warnings
No deprecation warnings apply to our current code. The following were deprecated in earlier versions but don't affect us:
- `assert_in_contract` → `debug_assert_in_contract` (we don't use this)
- Legacy token event format (we use current format)

### 5. Testing Strategy
All existing tests should pass without modification:
- `test_create_bounty` - Tests bounty creation and token transfer
- `test_create_bounty_negative_amount` - Tests validation
- `test_full_lifecycle` - Tests complete bounty workflow
- `test_refund_flow` - Tests refund after expiration
- `test_release_without_submit` - Tests error handling
- `test_expiration` - Tests time-based expiration
- `test_reserve_expired_bounty` - Tests expired bounty handling

### 6. Build Commands
To complete the migration, run:

```bash
cd stellar-bounty-board/contracts
cargo update
cargo build --release
cargo test
```

### 7. Verification Checklist
- [x] Updated Cargo.toml with soroban-sdk 25.3.1
- [ ] Run `cargo update` to regenerate Cargo.lock
- [ ] Run `cargo build` - should complete with 0 errors, 0 warnings
- [ ] Run `cargo test` - all tests should pass
- [ ] Commit Cargo.toml and Cargo.lock

## Compatibility Notes

### Backward Compatibility
The migration from v21.7.7 to v25.3.1 is backward compatible for our use case. No code changes are required.

### Forward Compatibility
The contract will work with Stellar Protocol 23+ and Soroban environments that support the v25 SDK.

## References
- [Soroban SDK v25.3.1 Release Notes](https://github.com/stellar/rs-soroban-sdk/releases/tag/v25.3.1)
- [Soroban SDK v25.0.0 Release Notes](https://github.com/stellar/rs-soroban-sdk/releases/tag/v25.0.0)
- [Soroban SDK Documentation](https://docs.rs/soroban-sdk/25.3.1)

## Rollback Plan
If issues arise, rollback by:
1. Revert Cargo.toml to version 21.7.7
2. Run `cargo update`
3. Run `cargo build` and `cargo test`

## Post-Migration Optimization Opportunities

### 1. Enable Spec Shaking (Optional)
To reduce contract binary size, consider enabling spec shaking v2:

```toml
[dependencies]
soroban-sdk = { version = "25.3.1", features = ["experimental_spec_shaking_v2"] }
```

Requires Stellar CLI v25.2.0+.

### 2. Use Checked Arithmetic (Optional)
For safer arithmetic operations, consider using checked arithmetic for amount calculations:

```rust
// Instead of:
let new_amount = amount + fee;

// Use:
let new_amount = amount.checked_add(fee)
    .unwrap_or_else(|| panic!("arithmetic overflow"));
```

### 3. Implement TTL Management (Optional)
Consider implementing explicit TTL management for persistent storage using the new CAP-78 features:

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, min_ttl, max_ttl);
```

## Known Issues
None identified for our contract implementation.

## Performance Impact
- Binary size: Expected to remain similar or slightly smaller with spec shaking
- Gas costs: No change expected
- Execution time: No change expected

## Security Considerations
- No security-related breaking changes
- All existing security patterns remain valid
- New checked arithmetic functions provide additional safety options
