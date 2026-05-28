# Deployment Guide

## Railway Deployment

### Required Environment Variables

Configure these in your Railway dashboard under the service's **Variables** section:

| Variable | Required | Example Value | Description |
|----------|----------|---------------|-------------|
| `PORT` | Yes | `3000` | Backend server port |
| `BOUNTY_STORE_PATH` | Yes | `/data/bounties.json` | Path to the bounty JSON store file |
| `MAINTAINER_PUBLIC_KEY` | Yes | `GA7...` | Stellar public key for bounty maintainer operations |
| `SOROBAN_CONTRACT_ID` | Yes | `CA...` | Deployed Soroban contract ID |
| `GITHUB_WEBHOOK_SECRET` | Yes | *(generate with `openssl rand -hex 32`)* | Secret for verifying GitHub webhook signatures |
| `NODE_ENV` | No | `production` | Environment mode |

### Setting Environment Variables in Railway

1. Open your project in [Railway Dashboard](https://railway.app/dashboard)
2. Select your service
3. Go to the **Variables** tab
4. Add each variable from the table above
5. Click **Deploy** to apply changes

### Health Check Configuration

Railway TCP health checks expect the endpoint to respond on the configured `PORT`. The health endpoint is available at `/api/health`.

Recommended health check settings:
- **Path**: `/api/health`
- **Interval**: 10s
- **Timeout**: 5s
- **Threshold**: 3 failures

### Common Deployment Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Port 3000 already in use` | Local Railway agent conflict | Set `PORT` to a different value |
| `BOUNTY_STORE_PATH not set` | Missing env variable | Add variable in Railway dashboard |
| `Invalid SOROBAN_CONTRACT_ID` | Wrong contract or testnet | Verify contract is deployed and address is correct |
| Webhook returns 500 | Missing or wrong `GITHUB_WEBHOOK_SECRET` | Regenerate secret and update both GitHub and Railway |
| `ENOENT: no such file` | Persistent volume not attached | Add a Railway volume at the path used by `BOUNTY_STORE_PATH` |

### Persistent Storage

Bounty data is stored as a JSON file. In Railway, attach a volume to persist data across redeploys:

1. Go to your service's **Settings** tab
2. Scroll to **Volumes**
3. Add a volume mounted at the directory containing `BOUNTY_STORE_PATH`
4. Redeploy the service

## Local Development

See [ONBOARDING.md](./ONBOARDING.md) for local setup instructions.
