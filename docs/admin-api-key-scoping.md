# Admin API Key Scoping

Stellar Bounty Board uses bcrypt-hashed API keys to protect admin-only backend
endpoints. Starting with this release, keys carry a **scope** that controls
which routes they may access.

## Scopes

| Scope                   | Env var                       | Can access                                                  |
| ----------------------- | ----------------------------- | ----------------------------------------------------------- |
| `admin-write` (default) | `ADMIN_API_KEY_HASH`          | All admin-protected routes — both read-only and mutating    |
| `read-only`             | `ADMIN_API_KEY_HASH_READONLY` | Only routes explicitly protected with the `read-only` scope |

### admin-write

Use for operations that modify bounty state or expose sensitive data. A full
admin key is always accepted on `read-only`-scoped routes too, so a single-key
deployment continues to work without any changes.

### read-only

Use for dashboards, analytics dashboards, and reporting integrations that only
need to query data. A read-only key is **rejected** on `admin-write`-scoped
routes — it cannot mutate bounty state.

## Environment variables

```
# .env
# Hash of the full admin key (required for any admin-protected route)
ADMIN_API_KEY_HASH=<bcrypt-hash>

# Hash of the read-only key (optional — omit if you only need one key)
ADMIN_API_KEY_HASH_READONLY=<bcrypt-hash>
```

Generate hashes with the helper script:

```bash
node scripts/hash-admin-key.js <your-admin-key>
node scripts/hash-admin-key.js <your-read-only-key>
```

## Protected routes

| Route                | Scope         |
| -------------------- | ------------- |
| `GET /api/audit-log` | `admin-write` |

## Middleware usage

```ts
import { createAdminApiKeyAuthMiddleware } from './middleware/adminAuth';

// Protects a sensitive admin-only write route (default scope — no argument needed)
app.post('/api/admin/action', createAdminApiKeyAuthMiddleware('admin-write'), handler);

// Protects a read-only reporting endpoint accessible by dashboard integrations
app.get('/api/admin/report', createAdminApiKeyAuthMiddleware('read-only'), handler);
```

## Backward compatibility

Existing deployments that only set `ADMIN_API_KEY_HASH` continue to work:

- Routes using `createAdminApiKeyAuthMiddleware()` (or `"admin-write"` scope)
  behave exactly as before.
- `read-only`-scoped routes also accept the full admin key when no separate
  `ADMIN_API_KEY_HASH_READONLY` is configured.

No migration is required for existing single-key deployments.

## Request header

All admin-protected routes expect the raw (unhashed) key in the
`x-admin-api-key` header:

```bash
curl -H "x-admin-api-key: <your-key>" http://localhost:3001/api/audit-log
```
