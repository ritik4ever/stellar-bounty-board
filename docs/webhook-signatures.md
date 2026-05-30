# Webhook Signature Verification

Use the backend webhook signature utility whenever a third-party service sends data into the API. This keeps webhook routes reusable and prevents unauthenticated traffic from reaching integration logic.

---

## Algorithm: HMAC-SHA256

Every webhook request is authenticated using **HMAC-SHA256** (Hash-based Message Authentication Code with SHA-256).

The sender (GitHub) computes:
```
signature = "sha256=" + HMAC_SHA256(key=WEBHOOK_SECRET, message=RAW_REQUEST_BODY)
```

The receiver (this backend) independently computes the same signature from the raw body and the shared secret, then compares both values in **constant time** to prevent timing attacks.

> ⚠️ **Timing-safe comparison is mandatory.**  
> A naïve string comparison (`===`) short-circuits on the first mismatched character, leaking information about how many characters match.  
> Always use `crypto.timingSafeEqual()` (Node.js) or `hmac.compare_digest()` (Python) — both are used in the examples below and in the backend implementation.

---

## Example: Node.js (built-in `crypto`)

```js
const crypto = require("crypto");

/**
 * Verify a GitHub-style HMAC-SHA256 webhook signature.
 * @param {string} secret   - Shared webhook secret
 * @param {string} payload  - Raw request body (string, not parsed JSON)
 * @param {string} header   - Value of X-Hub-Signature-256 header, e.g. "sha256=abc123..."
 * @returns {boolean}
 */
function verifyGitHubSignature(secret, payload, header) {
  if (!header || !header.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const received = header.slice("sha256=".length);

  // Timing-safe comparison — never use === here
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex")
  );
}

// Express usage
app.post("/api/webhooks/github", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-hub-signature-256"];
  if (!verifyGitHubSignature(process.env.GITHUB_WEBHOOK_SECRET, req.body.toString("utf8"), sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  res.json({ status: "ok" });
});
```

---

## Example: Python (`hmac` + `hashlib`)

```python
import hmac
import hashlib

def verify_github_signature(secret: str, payload: bytes, header: str) -> bool:
    """
    Verify a GitHub-style HMAC-SHA256 webhook signature.

    :param secret:  Shared webhook secret (plain string)
    :param payload: Raw request body as bytes
    :param header:  Value of X-Hub-Signature-256 header, e.g. "sha256=abc123..."
    :returns:       True if the signature is valid, False otherwise
    """
    if not header or not header.startswith("sha256="):
        return False

    expected = hmac.new(
        key=secret.encode("utf-8"),
        msg=payload,
        digestmod=hashlib.sha256,
    ).hexdigest()

    received = header[len("sha256="):]

    # Timing-safe comparison — never use == here
    return hmac.compare_digest(expected, received)


# Flask usage
from flask import Flask, request, abort
app = Flask(__name__)

@app.post("/api/webhooks/github")
def github_webhook():
    sig = request.headers.get("X-Hub-Signature-256", "")
    if not verify_github_signature(
        secret=os.environ["GITHUB_WEBHOOK_SECRET"],
        payload=request.get_data(),
        header=sig,
    ):
        abort(401)
    return {"status": "ok"}
```

---

## What exists today

- `backend/src/webhooks/signatureVerification.ts` provides a generic HMAC signature verifier.
- The same module exports GitHub defaults for `X-Hub-Signature-256` and `sha256=...` signatures.
- `/api/webhooks/github` is protected by the middleware and can be extended with GitHub event handling later.

## GitHub usage

Set `GITHUB_WEBHOOK_SECRET` in the backend environment, then protect the route with the GitHub middleware:

```ts
app.post(
  "/api/webhooks/github",
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  handler,
);
```

The middleware verifies the raw request body against the `X-Hub-Signature-256` header and returns `401` when the signature is missing or invalid.

## Local Testing with ngrok

Testing GitHub webhooks locally requires a public URL that GitHub can reach. **ngrok** creates a secure tunnel from GitHub to your local machine without exposing your actual IP.

### Step 1: Install ngrok

[Download ngrok](https://ngrok.com/download) for your platform:

```bash
# macOS (Homebrew)
brew install ngrok

# Or download from https://ngrok.com/download
```

### Step 2: Start the Backend

In one terminal, start the Express backend:

```bash
npm run dev:backend
```

The backend will be running on `http://localhost:3001`.

### Step 3: Create an ngrok Tunnel

In a second terminal, create a tunnel to port 3001:

```bash
ngrok http 3001
```

This output will look like:

```
ngrok                                           (Ctrl+C to quit)
Add authentication via the AuthToken option.
Add a domain via the API base url in the web inspect tool.

Session Status                online
Account                       [your-email@example.com]
Version                       3.3.5
Region                        us-central (California)
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://1a2b-203-0-113-42.ngrok.io -> http://localhost:3001
```

**Save the public URL:** `https://1a2b-203-0-113-42.ngrok.io` (this changes every restart)

### Step 4: Configure GitHub Webhook

1. Navigate to your repository → **Settings** → **Webhooks** → **Add webhook**
2. Set the following:
   - **Payload URL:** `https://1a2b-203-0-113-42.ngrok.io/api/webhooks/github` (use your ngrok URL)
   - **Content type:** `application/json`
   - **Secret:** Generate a strong secret (e.g., `openssl rand -hex 32`) — save this value
   - **Events:** Select which events to trigger on (e.g., "Pull requests", "Issues")
3. Click **Add webhook**

### Step 5: Set the Secret in Your Environment

Create or update `backend/.env`:

```env
# GitHub webhook secret from GitHub UI
GITHUB_WEBHOOK_SECRET=your_generated_secret_here
```

Restart the backend to pick up the environment variable:

```bash
# Stop and restart npm run dev:backend
```

### Step 6: Test the Webhook

Trigger a webhook event by:

1. **Opening an issue** or **editing a PR** in your test repository
2. Go to your GitHub webhook settings → scroll down to "Recent Deliveries"
3. Click on a delivery to see the request and response

In the **Response** tab, you should see:

**Success (200):**
```json
{
  "status": "ok",
  "message": "Webhook received and signature verified"
}
```

**Failure (401):**
```json
{
  "error": "Invalid signature"
}
```

### Step 7: Monitor with ngrok Web UI

Open `http://127.0.0.1:4040` in your browser to:

- See **real-time request/response logs**
- Inspect request headers and body
- Replay requests for testing
- Debug signature verification failures

---

## Troubleshooting

### "Connection refused" error

**Problem:** ngrok URL returns `Connection refused`

**Solution:**
1. Make sure the backend is running on `localhost:3001`
2. Restart ngrok and copy the new public URL
3. Update your GitHub webhook Payload URL with the new ngrok address

### "Invalid signature" (401 responses)

**Problem:** All webhook requests fail with `Invalid signature`

**Causes & fixes:**
1. **Secret mismatch** — Verify the secret in `backend/.env` matches exactly what you set in GitHub (case-sensitive)
2. **Raw body not captured** — The signature middleware must receive the raw request body; Express should not parse JSON before verification
3. **Secret copied incorrectly** — Re-generate the secret in GitHub UI and update `.env`, restart backend
4. **Whitespace in secret** — Ensure no leading/trailing spaces in `backend/.env`

**Test the secret locally:**
```bash
# Generate a test payload and verify signature
node scripts/test-webhook-signature.js
```

### "Webhook not delivering"

**Problem:** GitHub shows no recent deliveries

**Fixes:**
1. Verify the Payload URL is the current ngrok URL (it changes on restart)
2. Make sure the webhook is set to trigger on the right events
3. Check GitHub **webhook settings** → **Recent deliveries** tab — GitHub logs all attempts
4. Manually trigger an event (create an issue, open a PR) to test

### ngrok URL expired or changed

**Problem:** Webhook was working, now fails

**Why:** ngrok tunnels expire and change when restarted or when the free session ends

**Solution:**
1. Restart ngrok: `ngrok http 3001`
2. Copy the new public URL from the output
3. Update GitHub webhook settings with the new URL
4. Save changes

---

## For future integrations

- Reuse `createWebhookSignatureMiddleware(...)` for any provider that signs requests with an HMAC header.
- Keep raw body capture enabled so verification uses the original bytes sent by the provider.
- Add provider-specific wrappers when a new integration has a stable header name, prefix, and algorithm.
- Reject unsigned traffic before parsing event-specific fields or mutating any application state.

---

## Related Links

- [GitHub Webhook Documentation](https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks)
- [ngrok Documentation](https://ngrok.com/docs)
- [Contributing Guide](../CONTRIBUTING.md) — includes webhook-related contribution areas
