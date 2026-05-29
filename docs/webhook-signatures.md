# Webhook Signatures Integration Guide

This guide explains how webhook consumers can verify the authenticity of webhook payloads from the Stellar Bounty Board.

## Signature Format

Every webhook request includes the following headers:

| Header | Description |
|--------|-------------|
| `X-Bounty-Webhook-Signature` | HMAC-SHA256 signature of the payload |
| `X-Bounty-Webhook-Timestamp` | ISO 8601 timestamp of when the event occurred |
| `X-Bounty-Webhook-Event` | Event type (e.g., `bounty.created`, `bounty.claimed`) |

## Verification

### Node.js Example

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  // Timing-safe comparison
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  
  if (actual.length !== expectedBuf.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(actual, expectedBuf);
}
```

### Python Example

```python
import hmac
import hashlib
import json

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        json.dumps(payload, separators=(',', ':')).encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

## Replay Protection

Always check the `X-Bounty-Webhook-Timestamp` header:
- Reject timestamps older than 5 minutes
- Log and alert on timestamps in the future

## Troubleshooting

### 401 Unauthorized

1. Ensure the webhook secret matches what's configured in the Bounty Board
2. Verify the raw request body is used (not parsed/modified JSON)
3. Check that the request body encoding matches (UTF-8)

### Missing Signatures

- Ensure the webhook is enabled in the Bounty Board settings
- Verify the endpoint URL is correct and publicly accessible
- Check that the endpoint responds with 200 within 5 seconds

## See Also

- [API Documentation](API.md)
- [Security Policy](../SECURITY.md)
