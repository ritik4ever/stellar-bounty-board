# Soroban SDK Upgrade - Quick Reference

## TL;DR
✅ **No code changes needed**  
⏱️ **15 minutes to complete**  
🟢 **Low risk**  
📦 **v21.7.7 → v25.3.1**

## One-Command Verification
```bash
cargo update && cargo build --release && cargo test
```

## What Changed?
- `Cargo.toml`: soroban-sdk version updated
- `Cargo.lock`: Will be regenerated
- Code: **No changes required** ✅
- Tests: **No changes required** ✅

## Quick Commands

### Update Dependencies
```bash
cargo update
```

### Build
```bash
cargo build --release
```

### Test
```bash
cargo test
```

### Verify Version
```bash
cargo tree | grep soroban-sdk
```

### Full Verification
```bash
# Linux/macOS
./verify-migration.sh

# Windows
verify-migration.bat
```

## Expected Results
- ✅ Build: 0 errors, 0 warnings
- ✅ Tests: 7 passed, 0 failed
- ✅ Version: soroban-sdk v25.3.1

## If Something Goes Wrong

### Build Fails
```bash
cargo clean
cargo update
cargo build
```

### Tests Fail
```bash
cargo test -- --nocapture
```

### Rollback
```toml
# In Cargo.toml, change:
soroban-sdk = "21.7.7"
```
Then run:
```bash
cargo update && cargo build && cargo test
```

## Files to Commit
- ✅ `Cargo.toml` (already updated)
- ⏳ `Cargo.lock` (after cargo update)

## Documentation
- 📖 `UPGRADE_GUIDE.md` - Full instructions
- 📋 `MIGRATION_NOTES.md` - Technical details
- 📊 `SDK_UPGRADE_SUMMARY.md` - Executive summary
- 📝 `CHANGELOG_SDK_UPGRADE.md` - Detailed changelog

## Support
- 💬 [Stellar Discord](https://discord.gg/stellar)
- 🐛 [GitHub Issues](https://github.com/stellar/rs-soroban-sdk/issues)
- 📚 [Docs](https://docs.rs/soroban-sdk/25.3.1)

## Checklist
- [x] Cargo.toml updated
- [ ] cargo update run
- [ ] cargo build successful
- [ ] cargo test passed
- [ ] Cargo.lock committed
- [ ] Tested on testnet
- [ ] Deployed to mainnet

---
**Status:** Ready for verification  
**Time:** ~15 minutes  
**Risk:** Low 🟢
