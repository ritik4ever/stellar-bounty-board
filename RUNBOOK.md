# Operational Runbook

This runbook provides step-by-step procedures for common operational tasks in production. Use these procedures when you need to perform maintenance, recover from errors, or manage the bounty system.

## Table of Contents

- [Reset Bounty Store](#reset-bounty-store)
- [Rotate Maintainer Public Key](#rotate-maintainer-public-key)
- [Force-Expire a Reservation](#force-expire-a-reservation)
- [Recover from Corrupt JSON](#recover-from-corrupt-json)
- [Redeploy Contract](#redeploy-contract)

---

## Reset Bounty Store

**Use case:** Clear all bounty data during development, testing, or after a data migration error. This is a destructive operation.

### Prerequisites

- Access to the backend server (SSH or console)
- Write permissions to the data directory
- Backup of current bounty data (recommended)

### Steps

1. **Stop the backend service**
   ```bash
   # If using systemd
   sudo systemctl stop stellar-bounty-board-backend

   # If using Docker
   docker-compose down

   # If using Railway/Render: use the dashboard to stop the service
   ```

2. **Backup existing data**
   ```bash
   # Navigate to the backend directory
   cd /path/to/backend

   # Create backup directory
   mkdir -p backups/$(date +%Y%m%d_%H%M%S)

   # Copy bounty store and audit log
   cp data/bounties.json backups/$(date +%Y%m%d_%H%M%S)/
   cp data/bounties.audit.json backups/$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || true
   ```

3. **Reset the bounty store**
   ```bash
   # Option 1: Delete the files (will be recreated with sample data on restart)
   rm data/bounties.json
   rm data/bounties.audit.json

   # Option 2: Replace with empty array
   echo "[]" > data/bounties.json
   echo "[]" > data/bounties.audit.json
   ```

4. **Restart the backend service**
   ```bash
   # If using systemd
   sudo systemctl start stellar-bounty-board-backend

   # If using Docker
   docker-compose up -d

   # If using Railway/Render: use the dashboard to restart the service
   ```

5. **Verify the reset**
   ```bash
   # Check the API health endpoint
   curl https://your-backend.example.com/api/health

   # Verify empty bounty list
   curl https://your-backend.example.com/api/bounties
   ```

### Expected Output

- Health check returns `{ "status": "ok", ... }`
- `/api/bounties` returns either empty array `[]` or sample bounties (if using default initialization)
- No errors in backend logs

### Rollback

If you need to restore the previous data:
```bash
# Stop the service
sudo systemctl stop stellar-bounty-board-backend

# Restore from backup
cp backups/20240529_120000/bounties.json data/
cp backups/20240529_120000/bounties.audit.json data/

# Restart the service
sudo systemctl start stellar-bounty-board-backend
```

---

## Rotate Maintainer Public Key

**Use case:** A maintainer's Stellar public key has been compromised or needs to be changed for security reasons.

### Prerequisites

- Access to the backend server
- The new Stellar public key for the maintainer
- List of bounty IDs that need to be updated
- Backup of current bounty data

### Steps

1. **Backup current data**
   ```bash
   cd /path/to/backend
   mkdir -p backups/$(date +%Y%m%d_%H%M%S)
   cp data/bounties.json backups/$(date +%Y%m%d_%H%M%S)/
   cp data/bounties.audit.json backups/$(date +%Y%m%d_%H%M%S)/
   ```

2. **Stop the backend service**
   ```bash
   sudo systemctl stop stellar-bounty-board-backend
   ```

3. **Identify bounties to update**
   ```bash
   # Find all bounties with the old maintainer key
   OLD_KEY="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
   grep -n "\"maintainer\": \"$OLD_KEY\"" data/bounties.json
   ```

4. **Update the maintainer key**
   ```bash
   # Use sed to replace the old key with the new key
   OLD_KEY="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
   NEW_KEY="GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

   sed -i "s/$OLD_KEY/$NEW_KEY/g" data/bounties.json
   ```

5. **Validate the JSON**
   ```bash
   # Ensure the file is still valid JSON
   python3 -m json.tool data/bounties.json > /dev/null
   echo "JSON is valid"
   ```

6. **Restart the backend service**
   ```bash
   sudo systemctl start stellar-bounty-board-backend
   ```

7. **Verify the update**
   ```bash
   # Check that bounties now show the new maintainer key
   curl https://your-backend.example.com/api/bounties | grep "$NEW_KEY"
   ```

### Expected Output

- JSON validation passes without errors
- API returns bounties with the new maintainer key
- No errors in backend logs
- Audit log shows the key change (if you manually add an audit entry)

### Important Notes

- This updates the maintainer key in the JSON store only. If the Soroban contract is deployed, you may need to update on-chain data as well.
- Consider adding an audit log entry for this change:
  ```bash
  # Manually add an audit entry (optional but recommended)
  AUDIT_ENTRY='{
    "id": "AUD-999999",
    "bountyId": "BNT-0001",
    "fromStatus": "open",
    "toStatus": "open",
    "transition": "maintainer_key_rotation",
    "actor": "admin",
    "timestamp": '$(date +%s)',
    "metadata": {
      "oldKey": "'$OLD_KEY'",
      "newKey": "'$NEW_KEY'"
    }
  }'
  
  # Append to audit log
  echo "$AUDIT_ENTRY" >> data/bounties.audit.json
  ```

---

## Force-Expire a Reservation

**Use case:** A contributor has reserved a bounty but is unresponsive, and you need to release it back to the pool before the reservation timeout expires.

### Prerequisites

- Access to the backend server
- The bounty ID to force-expire
- Backup of current bounty data

### Steps

1. **Backup current data**
   ```bash
   cd /path/to/backend
   mkdir -p backups/$(date +%Y%m%d_%H%M%S)
   cp data/bounties.json backups/$(date +%Y%m%d_%H%M%S)/
   cp data/bounties.audit.json backups/$(date +%Y%m%d_%H%M%S)/
   ```

2. **Stop the backend service**
   ```bash
   sudo systemctl stop stellar-bounty-board-backend
   ```

3. **Locate the bounty in the JSON file**
   ```bash
   # Find the bounty by ID
   BOUNTY_ID="BNT-0001"
   grep -A 20 "\"id\": \"$BOUNTY_ID\"" data/bounties.json
   ```

4. **Update the bounty status**
   ```bash
   # Use a script to update the bounty (Python example)
   python3 << 'EOF'
import json
import sys

bounty_id = "BNT-0001"
file_path = "data/bounties.json"

with open(file_path, 'r') as f:
    bounties = json.load(f)

for bounty in bounties:
    if bounty['id'] == bounty_id:
        bounty['status'] = 'open'
        bounty['contributor'] = None
        bounty['reservedAt'] = None
        bounty['version'] = bounty.get('version', 0) + 1
        bounty['events'].append({
            'type': 'expired',
            'timestamp': int(__import__('time').time()),
            'details': {'reason': 'admin_force_expire'}
        })
        print(f"Updated bounty {bounty_id}")
        break

with open(file_path, 'w') as f:
    json.dump(bounties, f, indent=2)

print("Done")
EOF
   ```

5. **Add audit log entry**
   ```bash
   python3 << 'EOF'
import json
import time

audit_entry = {
    "id": "AUD-" + str(int(time.time())),
    "bountyId": "BNT-0001",
    "fromStatus": "reserved",
    "toStatus": "open",
    "transition": "expire",
    "actor": "admin",
    "timestamp": int(time.time()),
    "metadata": {
        "reason": "admin_force_expire",
        "manual_intervention": True
    }
}

audit_file = "data/bounties.audit.json"
with open(audit_file, 'r') as f:
    audits = json.load(f)

audits.append(audit_entry)

with open(audit_file, 'w') as f:
    json.dump(audits, f, indent=2)

print("Audit log updated")
EOF
   ```

6. **Validate the JSON**
   ```bash
   python3 -m json.tool data/bounties.json > /dev/null
   python3 -m json.tool data/bounties.audit.json > /dev/null
   echo "JSON is valid"
   ```

7. **Restart the backend service**
   ```bash
   sudo systemctl start stellar-bounty-board-backend
   ```

8. **Verify the update**
   ```bash
   # Check the bounty status via API
   curl https://your-backend.example.com/api/bounties | grep "BNT-0001"
   ```

### Expected Output

- JSON validation passes
- Bounty status changes from `reserved` to `open`
- Contributor field is cleared
- Audit log shows the force-expire action
- API returns the updated bounty

### Alternative: API-Based Approach

If you have admin access to the API, you can use the refund endpoint instead:
```bash
# Refund the bounty (only works for open or reserved bounties)
curl -X POST https://your-backend.example.com/api/bounties/BNT-0001/refund \
  -H "Content-Type: application/json" \
  -d '{
    "maintainer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
  }'
```

Then recreate the bounty with the same details.

---

## Recover from Corrupt JSON

**Use case:** The bounty store or audit log file has become corrupted (invalid JSON) and the backend is failing to start.

### Prerequisites

- Access to the backend server
- Backup of the corrupted file
- Text editor or JSON repair tool

### Steps

1. **Identify the corruption**
   ```bash
   # Try to validate the JSON
   python3 -m json.tool data/bounties.json
   # Note the error message and line number
   ```

2. **Backup the corrupted file**
   ```bash
   cp data/bounties.json data/bounties.json.corrupted.$(date +%Y%m%d_%H%M%S)
   cp data/bounties.audit.json data/bounties.audit.json.corrupted.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
   ```

3. **Attempt to repair the JSON**

   **Option A: Use jq (if available)**
   ```bash
   # Try to parse and reformat (may fix simple issues)
   jq '.' data/bounties.json > data/bounties.json.repaired 2>&1
   
   # If successful, replace the original
   if [ $? -eq 0 ]; then
     mv data/bounties.json.repaired data/bounties.json
     echo "JSON repaired successfully"
   fi
   ```

   **Option B: Manual repair with text editor**
   ```bash
   # Open the file in a text editor
   nano data/bounties.json
   # or
   vim data/bounties.json
   
   # Look for common issues:
   # - Missing commas between array elements
   # - Trailing commas
   # - Unclosed brackets or braces
   # - Invalid escape sequences
   ```

   **Option C: Extract valid data and rebuild**
   ```bash
   # If the file is severely corrupted, extract what you can
   python3 << 'EOF'
import json
import re

file_path = "data/bounties.json"

try:
    # Try to read as much as possible
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Find all JSON objects (bounty records)
    pattern = r'\{[^{}]*"id"[^{}]*\}'
    matches = re.findall(pattern, content, re.DOTALL)
    
    valid_bounties = []
    for match in matches:
        try:
            bounty = json.loads(match)
            if 'id' in bounty:
                valid_bounties.append(bounty)
        except:
            continue
    
    # Write the recovered data
    with open(file_path, 'w') as f:
        json.dump(valid_bounties, f, indent=2)
    
    print(f"Recovered {len(valid_bounties)} bounty records")
except Exception as e:
    print(f"Error: {e}")
EOF
   ```

4. **Validate the repaired file**
   ```bash
   python3 -m json.tool data/bounties.json > /dev/null
   if [ $? -eq 0 ]; then
     echo "JSON is now valid"
   else
     echo "JSON still invalid, manual repair needed"
   fi
   ```

5. **Handle the audit log (if corrupted)**
   ```bash
   # The audit log can be safely reset to an empty array if needed
   echo "[]" > data/bounties.audit.json
   echo "Audit log reset to empty array"
   ```

6. **Restart the backend service**
   ```bash
   sudo systemctl start stellar-bounty-board-backend
   ```

7. **Verify the system is working**
   ```bash
   # Check health endpoint
   curl https://your-backend.example.com/api/health
   
   # Check bounty list
   curl https://your-backend.example.com/api/bounties
   ```

### Expected Output

- JSON validation passes
- Backend service starts successfully
- API returns bounty data (may be reduced if data was lost)
- No errors in logs

### Data Recovery Notes

- If data was lost during recovery, check the corrupted backup file for recoverable fragments
- Consider reaching out to maintainers to recreate lost bounties if necessary
- Audit log can be rebuilt from bounty event history if needed

---

## Redeploy Contract

**Use case:** Deploy a new version of the Soroban smart contract or redeploy after a failed deployment.

### Prerequisites

- Rust and Soroban CLI installed
- Access to Stellar network (testnet or mainnet)
- Wallet with sufficient XLM for deployment fees
- Contract source code in `contracts/`

### Steps

1. **Prepare the environment**
   ```bash
   # Navigate to contracts directory
   cd /path/to/stellar-bounty-board/contracts
   
   # Install Soroban CLI if not already installed
   cargo install soroban-cli
   
   # Set the network (testnet or mainnet)
   export SOROBAN_NETWORK_URL="https://rpc-futurenet.stellar.org"  # for testnet
   # export SOROBAN_NETWORK_URL="https://rpc.mainnet.stellar.org"  # for mainnet
   ```

2. **Build the contract**
   ```bash
   # Build the contract
   cargo build --target wasm32-unknown-unknown --release
   
   # The WASM file will be at target/wasm32-unknown-unknown/release/stellar_bounty_board.wasm
   ```

3. **Optimize the WASM file**
   ```bash
   # Optimize for deployment
   soroban contract optimize target/wasm32-unknown-unknown/release/stellar_bounty_board.wasm \
     --wasm target/wasm32-unknown-unknown/release/stellar_bounty_board_opt.wasm
   ```

4. **Deploy the contract**
   ```bash
   # Deploy to the network
   CONTRACT_ID=$(soroban contract deploy \
     --wasm target/wasm32-unknown-unknown/release/stellar_bounty_board_opt.wasm \
     --source YOUR_SECRET_KEY \
     --network $SOROBAN_NETWORK_URL)
   
   echo "Contract deployed with ID: $CONTRACT_ID"
   ```

5. **Update environment variables**
   ```bash
   # Update the backend environment with the new contract ID
   export SOROBAN_CONTRACT_ID=$CONTRACT_ID
   
   # If using Railway/Render, update the environment variable in the dashboard
   # If using Docker, update the docker-compose.yml or .env file
   # If using systemd, update the service environment file
   ```

6. **Test the contract**
   ```bash
   # Run contract tests
   cargo test
   
   # Or invoke a contract method to verify
   soroban contract invoke \
     --id $CONTRACT_ID \
     --source YOUR_SECRET_KEY \
     --network $SOROBAN_NETWORK_URL \
     -- \
     get_bounty \
     --bounty_id 1
   ```

7. **Restart the backend service**
   ```bash
   # Restart to pick up the new contract ID
   sudo systemctl restart stellar-bounty-board-backend
   ```

8. **Verify the deployment**
   ```bash
   # Check backend health
   curl https://your-backend.example.com/api/health
   
   # Verify the contract is accessible
   curl https://your-backend.example.com/api/bounties
   ```

### Expected Output

- Contract deployment succeeds with a new contract ID
- Contract tests pass
- Backend service starts successfully
- API endpoints respond correctly
- No errors in logs related to contract interaction

### Rollback

If the new deployment has issues:
```bash
# Revert to the previous contract ID
export SOROBAN_CONTRACT_ID=OLD_CONTRACT_ID

# Restart the backend service
sudo systemctl restart stellar-bounty-board-backend
```

### Important Notes

- Contract deployment is irreversible on mainnet. Always test on testnet first.
- Keep a record of all deployed contract IDs for audit purposes.
- Update any frontend configuration if it references the contract ID directly.
- Consider using a contract upgrade pattern if frequent updates are expected.

---

## Additional Resources

- [Deployment Guide](./docs/deployment.md) - Full deployment documentation
- [Architecture Documentation](./docs/ARCHITECTURE.md) - System architecture and data flow
- [ONBOARDING.md](./ONBOARDING.md) - Development setup guide

## Emergency Contacts

If you encounter an issue not covered in this runbook:
- Open an issue in the GitHub repository
- Contact the maintainers via the project's communication channels
- Check the [GitHub Issues](https://github.com/your-org/stellar-bounty-board/issues) for similar problems
