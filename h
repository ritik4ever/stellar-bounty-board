[1mdiff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml[m
[1mindex a16ad98..335d02b 100644[m
[1m--- a/.github/workflows/ci.yml[m
[1m+++ b/.github/workflows/ci.yml[m
[36m@@ -114,7 +114,7 @@[m [mjobs:[m
       - name: Setup Rust[m
         uses: actions-rust-lang/setup-rust-toolchain@v1[m
         with:[m
[31m-          target: wasm32-unknown-unknown[m
[32m+[m[32m          target: wasm32v1-none[m
 [m
       - name: Cache Rust dependencies[m
         uses: actions/cache@v4[m
[36m@@ -140,5 +140,8 @@[m [mjobs:[m
           name: contract-audit[m
           path: contract-audit.log[m
 [m
[32m+[m[32m      - name: Install wasm-opt[m
[32m+[m[32m        run: sudo apt-get update && sudo apt-get install -y binaryen[m
[32m+[m
       - name: Build Soroban contract[m
[31m-        run: cd contracts && cargo build --target wasm32-unknown-unknown --release[m
[32m+[m[32m        run: cd contracts && ./build.sh[m
[1mdiff --git a/.github/workflows/soroban-contract-ci.yml b/.github/workflows/soroban-contract-ci.yml[m
[1mindex df460a7..b5bb300 100644[m
[1m--- a/.github/workflows/soroban-contract-ci.yml[m
[1m+++ b/.github/workflows/soroban-contract-ci.yml[m
[36m@@ -42,7 +42,7 @@[m [mjobs:[m
         uses: actions-rs/toolchain@v1[m
         with:[m
           toolchain: stable[m
[31m-          target: wasm32-unknown-unknown[m
[32m+[m[32m          target: wasm32v1-none[m
           components: clippy[m
           profile: minimal[m
           override: true[m
[36m@@ -58,13 +58,16 @@[m [mjobs:[m
         working-directory: contracts[m
         run: cargo test --all --verbose[m
 [m
[32m+[m[32m      - name: Install wasm-opt[m
[32m+[m[32m        run: sudo apt-get update && sudo apt-get install -y binaryen[m
[32m+[m
       - name: Build release wasm[m
         working-directory: contracts[m
[31m-        run: cargo build --release --target wasm32-unknown-unknown[m
[32m+[m[32m        run: ./build.sh[m
 [m
       - name: Report WASM size in summary[m
         run: |[m
[31m-          WASM_FILE=$(ls contracts/target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || true)[m
[32m+[m[32m          WASM_FILE=$(ls contracts/target/wasm32v1-none/release/*.wasm 2>/dev/null || true)[m
           if [ -n "$WASM_FILE" ]; then[m
             echo "### WASM binary size" >> $GITHUB_STEP_SUMMARY[m
             SIZE=$(stat -c%s "$WASM_FILE")[m
[1mdiff --git a/contracts/README.md b/contracts/README.md[m
[1mindex 5667e11..4838642 100644[m
[1m--- a/contracts/README.md[m
[1m+++ b/contracts/README.md[m
[36m@@ -1,5 +1,15 @@[m
 # Stellar Bounty Board Contract[m
 [m
[32m+[m[32m## Optimized release build[m
[32m+[m
[32m+[m[32mRun the contract production build from the `contracts/` directory:[m
[32m+[m
[32m+[m[32m```bash[m
[32m+[m[32m./build.sh[m
[32m+[m[32m```[m
[32m+[m
[32m+[m[32mThis runs the contract tests, compiles the contract for `wasm32v1-none`, applies `wasm-opt -Oz`, and refreshes `BENCHMARKS.md` with the binary size before and after optimization.[m
[32m+[m
 ## Error Codes[m
 [m
 The contract uses named error codes for all invalid operations. These codes are emitted as panic messages in tests.[m
