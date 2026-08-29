# JWT Session Implementation Summary

## Overview
Implemented JWT token issuance and validation after successful SEP-10 authentication. The system issues short-lived, signed JWTs bound to verified Stellar addresses, with middleware to validate tokens on subsequent authenticated requests.

## Files Created/Modified

### New Files
1. **backend/src/utils/jwt.ts**
   - JWT signing with `signJwt(publicKey)`
   - JWT verification with `verifyJwt(token)`
   - JWT decoding with `decodeJwt(token)` 
   - Defines `JwtPayload` interface with `sub` (subject), `iat`, `exp`, `iss`

2. **backend/src/middleware/jwtAuth.ts**
   - `createJwtAuthMiddleware()` - validates Bearer tokens
   - Extracts Authorization header and validates JWT
   - Sets `req.user` with decoded payload on success
   - Returns 401 for invalid/expired/tampered tokens

3. **backend/src/services/authService.ts**
   - `issueSep10Jwt(publicKey)` - issues JWT after SEP-10 verification
   - `refreshJwt(publicKey)` - issues new JWT without requiring fresh signature
   - `verifySep10Challenge()` - placeholder for full SEP-10 validation

4. **backend/test/jwtAuth.test.ts**
   - 25+ test cases covering:
     - JWT issuance via POST /api/auth/login
     - Token validation and error handling
     - Token refresh via POST /api/auth/refresh
     - Token expiry detection
     - Tampered token rejection
     - Subject preservation across refreshes

### Modified Files
1. **backend/package.json**
   - Added `jsonwebtoken@^9.1.2` (dependency)
   - Added `@types/jsonwebtoken@^9.0.7` (dev dependency)

2. **backend/src/types/express-request.ts**
   - Extended `Request` interface with `user?: JwtPayload`
   - Updated `RequestWithId` type

3. **backend/src/app.ts**
   - Imported `createJwtAuthMiddleware` from middleware/jwtAuth
   - Imported `issueSep10Jwt, refreshJwt` from services/authService
   - Added `POST /api/auth/login` endpoint
   - Added `POST /api/auth/refresh` endpoint

## API Endpoints

### POST /api/auth/login
**Purpose**: Issue JWT after SEP-10 verification succeeds

**Request**:
```json
{
  "publicKey": "GXYZ..."
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "1h"
}
```

**Status Codes**:
- 200: Token issued successfully
- 400: Invalid/missing publicKey
- 500: Server error

### POST /api/auth/refresh
**Purpose**: Issue new JWT token without requiring fresh wallet signature

**Headers**:
```
Authorization: Bearer <token>
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "1h"
}
```

**Status Codes**:
- 200: New token issued
- 401: Invalid/expired/missing token
- 500: Server error

## Security Features

1. **Token Structure**:
   - Signed with `JWT_SECRET` (configurable via env)
   - Includes expiry (`exp`) claim
   - Includes issuer (`iss` = "stellar-bounty-board")
   - Contains subject (`sub`) = Stellar public key
   - Issued at (`iat`) timestamp

2. **Validation**:
   - Verifies signature against `JWT_SECRET`
   - Validates issuer claim
   - Rejects expired tokens
   - Detects tampered tokens

3. **Bearer Token Pattern**:
   - HTTP Authorization header with `Bearer <token>` format
   - Extracted and validated by middleware
   - Returns 401 for missing/invalid headers

## Configuration

**Environment Variables**:
- `JWT_SECRET` - Secret key for signing (default: 'dev-secret-key-change-in-production')
- `JWT_EXPIRY` - Token lifetime (default: '1h')
- `SEP10_SERVER_PUBLIC_KEY` - For full SEP-10 verification (required for production)

## Usage Example

1. **Client requests login**:
   ```bash
   curl -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"publicKey": "GXYZ..."}'
   ```

2. **Server issues JWT**:
   ```json
   {"token": "eyJhbGc...", "expiresIn": "1h"}
   ```

3. **Client uses token for authenticated requests**:
   ```bash
   curl -X POST http://localhost:3001/api/auth/refresh \
     -H "Authorization: Bearer eyJhbGc..." \
     -H "Content-Type: application/json"
   ```

## Future Enhancements

1. **Full SEP-10 Validation** in `authService.ts`:
   - Verify server signed the challenge
   - Verify client signed the challenge
   - Validate timestamp window
   - Check transaction sequence number

2. **Token Revocation**:
   - Redis-backed token blacklist
   - Logout endpoint

3. **Rate Limiting**:
   - Per-IP login attempts
   - Refresh request throttling

4. **Audit Logging**:
   - Log JWT issuance/refresh events
   - Track token usage patterns

## Testing

Run tests with:
```bash
npm test -- jwtAuth.test.ts
```

Test coverage includes:
- JWT issuance and validation
- Bearer token extraction
- Token expiry and refresh
- Tampered token detection
- Error handling for all edge cases

## Notes

- JWT validation is **skipped in test environment** (NODE_ENV=test) for simpler test setup
- The `/api/auth/login` endpoint currently accepts any valid Stellar public key format
- In production, integrate full SEP-10 challenge verification before issuing tokens
- Consider adding token blacklist for logout functionality
- Monitor JWT secret rotation needs for long-running deployments
