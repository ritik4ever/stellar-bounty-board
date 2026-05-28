# Webhook Signatures Integration Guide

## Overview

The bounty board sends webhook events to configured endpoints. Each payload includes a signature header for verification.

## Verifying Signatures

Every webhook request includes a `X-Bounty-Signature-256` header containing an HMAC-SHA256 signature.

### Verification Steps

1. Extract the raw request body as a string
2. Compute HMAC-SHA256 using your webhook secret
3. Base64-encode the result
4. Compare with the `X-Bounty-Signature-256` header

### Example (Node.js)

\`\`\`javascript
const crypto = require('crypto');

function verifyWebhook(body, signature, secret) {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature)
  );
}
\`\`\`

### Example (Python)

\`\`\`python
import hmac, hashlib, base64

def verify_webhook(body, signature, secret):
    computed = base64.b64encode(
        hmac.new(secret.encode(), body, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(computed, signature)
\`\`\`

## Security Notes

- Rotate your webhook secret regularly
- Use constant-time comparison to prevent timing attacks
- Reject requests with missing or invalid signatures
- Set reasonable timeout on webhook processing (max 10s)
