# Contract Instruction Count Benchmarks

This document contains instruction count benchmarks for all Stellar Bounty Board contract entry points.

## Running Benchmarks

To run the instruction count benchmarks:

```bash
cd contracts
cargo test benchmark -- --nocapture
```

This will output CPU instruction count and memory usage for each entry point.

## Benchmark Results

The following table shows the CPU instruction count and memory usage for each contract entry point.

**Note:** These measurements are from Rust test execution and are likely underestimated compared to actual WASM execution on-chain. For production cost estimation, use RPC simulation.

| Entry Point | CPU Instructions | Memory (bytes) | Notes |
|-------------|-----------------|----------------|-------|
| `initialize` | TBD | TBD | Contract initialization |
| `create_bounty` | TBD | TBD | Creates new bounty with token transfer |
| `reserve_bounty` | TBD | TBD | Reserves bounty for contributor |
| `submit_bounty` | TBD | TBD | Submits completed work |
| `release_bounty` | TBD | TBD | Releases payment to contributor (with fee deduction) |
| `refund_bounty` | TBD | TBD | Refunds to maintainer after deadline |
| `extend_deadline` | TBD | TBD | Extends bounty deadline |
| `dispute_bounty` | TBD | TBD | Raises dispute for arbiter resolution |
| `resolve_dispute` (release) | TBD | TBD | Resolves dispute by releasing to contributor |
| `resolve_dispute` (refund) | TBD | TBD | Resolves dispute by refunding to maintainer |
| `get_bounty` | TBD | TBD | Read-only bounty retrieval |
| `get_fee_recipient` | TBD | TBD | Read-only fee recipient retrieval |
| `get_next_bounty_id` | TBD | TBD | Read-only next ID retrieval |

## Cost Analysis

### High-Cost Operations

Operations that involve token transfers (`create_bounty`, `release_bounty`, `refund_bounty`, `resolve_dispute`) typically have higher instruction counts due to:

- Token contract invocations
- Storage writes for balance updates
- Event emissions

### Low-Cost Operations

Read-only operations (`get_bounty`, `get_fee_recipient`, `get_next_bounty_id`) have minimal costs as they only perform:

- Storage reads
- No state mutations
- No external contract calls

### Medium-Cost Operations

State transition operations (`reserve_bounty`, `submit_bounty`, `extend_deadline`, `dispute_bounty`) have moderate costs due to:

- Storage reads and writes
- State validation checks
- Event emissions

## Benchmark Implementation

The benchmarks use Soroban SDK's `cost_estimate().budget()` API:

```rust
env.cost_estimate().budget().reset_default();
// Execute contract function
println!("CPU: {}", env.cost_estimate().budget().cpu_instruction_cost());
println!("Memory: {}", env.cost_estimate().budget().memory_bytes_cost());
```

### Important Notes

1. **Underestimation:** Rust test execution underestimates costs compared to WASM execution
2. **Production Costs:** Use RPC simulation for accurate production cost estimates
3. **Network Variance:** Actual costs may vary based on network conditions
4. **Fee Impact:** Operations with protocol fees have additional token transfer overhead

## Updating Benchmarks

When modifying contract logic:

1. Re-run benchmarks: `cargo test benchmark -- --nocapture`
2. Update this document with new measurements
3. Investigate significant cost regressions
4. Consider optimizations if costs increase substantially

## Cost Optimization Tips

- Minimize storage operations by batching when possible
- Use efficient data structures for storage
- Avoid unnecessary token transfers
- Cache frequently accessed data
- Consider event emission overhead

## References

- [Soroban SDK Budget Documentation](https://docs.rs/soroban-sdk/latest/soroban_sdk/testutils/budget/struct.Budget.html)
- [Cost Estimation Best Practices](https://developers.stellar.org/docs/build/smart-contracts/debugging/cost-estimation)
