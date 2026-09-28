- [Render (Backend) & Vercel (Frontend)](#render-vercel)
- [Railway One-Click Deployment](#railway)

---

## Render & Vercel <a name="render-vercel"></a>

### Backend Deployment: Render

1. Go to [Render](https://render.com/) and click **New Web Service**.
2. Connect your fork of this repo and select `backend/` as the root directory.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Health check path: `/api/health`
   - A healthy response: `{ "service": "stellar-bounty-board-backend", "status": "ok", ... }`
6. Ensure the port is set to `3001` (or use `process.env.PORT` as Render provides).
7. Set production CORS variables (see [CORS configuration](#cors-configuration) below).

### Frontend Deployment: Vercel

---

## Railway One-Click Deployment <a name="railway"></a>

[Railway](https://railway.com/) is a popular alternative to Render that offers one-click GitHub repo deployment. It auto-detects Node.js projects and provides generous free tier limits.

### Prerequisites

- A [Railway](https://railway.com/) account (sign up with GitHub)
- Your fork of this repository

### Deployment Steps

#### Quick Deploy (Recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template?template_url=https://github.com/ritik4ever/stellar-bounty-board)

Click the button above or follow the manual steps below.

#### Manual Deployment

1. **Create a New Project**
   - Go to [Railway Dashboard](https://railway.com/dashboard)
   - Click **New Project** → **Deploy from GitHub repo**
   - Select your fork of `stellar-bounty-board`

2. **Configure the Backend Service**
   - Railway will auto-detect the Node.js project in the root
   - Set the **Root Directory** to `backend/`
   - Build command (auto-detected): `npm install && npm run build`
   - Start command (auto-detected): `npm start`
   - Railway assigns a `${{PORT}}` environment variable automatically (overrides the default `3001`)

   | Variable                  | Required      | Example Value                     | Description                                      |
   | ------------------------- | ------------- | --------------------------------- | ------------------------------------------------ |
   | `GITHUB_WEBHOOK_SECRET`   | ✅ Yes        | `your_webhook_secret`             | Secret for GitHub webhook verification           |
   | `NODE_ENV`                | ✅ Yes (prod) | `production`                      | Environment mode                                 |
   | `ALLOWED_ORIGINS`         | ✅ Yes (prod) | `https://bounty-board.vercel.app` | Production frontend origin allowlist             |
   | `CORS_ORIGINS`            | ❌ No         | `*` or `http://localhost:3000`    | Development CORS origins (ignored in production) |
   | `BOUNTY_STORE_PATH`       | ❌ No         | `./data/bounties.json`            | Bounty data file (default)                       |
   | `BOUNTY_AUDIT_STORE_PATH` | ❌ No         | `./data/audit.json`               | Audit log file (default)                         |
   | `LOG_LEVEL`               | ❌ No         | `info`                            | Logging level                                    |

---

## CORS configuration <a name="cors-configuration"></a>

The backend restricts browser cross-origin access in production using an explicit allowlist.

### Production

Set these on your backend host (Render, Railway, Docker, etc.):

```env
NODE_ENV=production
ALLOWED_ORIGINS=https://bounty-board.vercel.app
```

- `ALLOWED_ORIGINS` is a comma-separated list of frontend URLs allowed to call the API.
- Requests from unrecognized browser origins receive **HTTP 403** on CORS preflight (`OPTIONS`).
- If `ALLOWED_ORIGINS` is unset in production, the server logs a warning and rejects browser origins.

### Local development

Development defaults to permissive CORS (`*`) so any local frontend origin works without configuration.

Override with an explicit list when needed:

```env
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000
```

`CORS_ORIGINS` and `ALLOWED_ORIGINS` are both honored in development; `CORS_ORIGINS` takes precedence.

---

## Required Environment Variables

---

## Health Check Paths

- Backend: `/api/health` (should return `{ "status": "ok", ... }`)
- Frontend: `/` (should load the React dashboard)

These paths answer "is the process alive?". For "did this deploy actually work?", see the
post-deploy smoke test below — it is the same question asked end to end.

---

## Post-deploy smoke test <a name="post-deploy-smoke-test"></a>

A successful build proves the bundle or image was produced, not that the running app
answers or can reach its dependencies. `.github/workflows/post-deploy-smoke.yml` closes
that gap: it runs `scripts/post-deploy-smoke.mjs` against the **live** deployments after
every completed deploy (Render and Vercel report completed deploys as GitHub
`deployment_status` events) and fails the check when either does not respond correctly.

| Check | Request | Passes when |
| --- | --- | --- |
| Backend liveness | `GET {BACKEND_BASE_URL}/api/health` | HTTP 200 with `"status": "ok"` |
| Backend readiness | `GET {BACKEND_BASE_URL}/api/health/deep` | HTTP 200, `"overall": "up"`, and every component (`store`, `soroban`, `contract`, `auth`) `up` |
| Frontend root | `GET {FRONTEND_BASE_URL}/` | HTTP 200, an HTML content type, and the built SPA shell (`<div id="root">`, a module script tag, the page title) |

The readiness check is the one that matters most: it catches a deploy that boots and then
fails to reach its bounty store, Soroban RPC, contract ID or auth configuration — exactly
the failure a build-success-only pipeline cannot see. Each check retries (default: 10
attempts, 15s apart) to absorb cold starts and alias propagation, then fails.

### Configure the URLs (once per repository)

Set two repository variables under **Settings → Secrets and variables → Actions →
Variables**. Secrets with the same names are also read, so either location works.

| Name | Example value |
| --- | --- |
| `BACKEND_BASE_URL` | `https://stellar-bounty-board-api.onrender.com` |
| `FRONTEND_BASE_URL` | `https://stellar-bounty-board.vercel.app` |

The job fails with exit code `2` and an explicit message when either is missing, so a
misconfigured pipeline never reports a green smoke test.

### Run it manually

Use the workflow's **Run workflow** button, or:

```bash
gh workflow run post-deploy-smoke.yml \
  -f backend_base_url=https://stellar-bounty-board-api.onrender.com \
  -f frontend_base_url=https://stellar-bounty-board.vercel.app
```

To run the same checks by hand against any deployment:

```bash
BACKEND_BASE_URL=https://stellar-bounty-board-api.onrender.com \
FRONTEND_BASE_URL=https://stellar-bounty-board.vercel.app \
  npm run smoke:post-deploy
```

Optional tuning: `SMOKE_ATTEMPTS` (default 10), `SMOKE_DELAY_MS` (default 15000),
`SMOKE_TIMEOUT_MS` (default 10000). Exit codes: `0` all checks passed, `1` at least one
check failed, `2` the script was misconfigured.

### Making a failed smoke test block the deploy

The workflow fails the commit's check run, so `Post-deploy smoke test` appears as a
failed check on the deployed revision. To make that failure stop a deploy from being
treated as good:

1. Add `Post-deploy smoke test` to the required status checks on `main` (branch
   protection rules).
2. Turn on the platform's "wait for CI before promoting" option where available — on
   Render that is *Settings → Build & Deploy → Auto-Deploy → After CI Checks Pass*.
   Vercel does not gate deploys on GitHub checks by default, so treat a red check as the
   signal to use **Instant Rollback**.
3. Re-run the smoke test after rolling back to confirm the previous revision is healthy
   again.

---

## Common Deployment Issues & Fixes

- **Build fails:** Check Node.js version (18+), install all dependencies, and verify build commands.
- **API not reachable:** Confirm backend is live and CORS is configured (`ALLOWED_ORIGINS` in production).

- **Frontend shows blank:** Ensure correct output directory (`dist`) and that the API URL is set.

---

---

## Docker Deployment

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed locally or on server

### Local Full-Stack Development with Docker Compose

Run the entire stack locally using Docker Compose:

```bash
docker-compose up --build
```

This starts:

- **Backend:** `http://localhost:3001/api`
- **Frontend:** `http://localhost:5173`

Set environment variables in a `.env.local` file (in the project root):

```env
SOROBAN_CONTRACT_ID=your-contract-id
SOROBAN_RPC_URL=https://rpc-futurenet.stellar.org
```

Docker Compose will pass these to the containers automatically.

#### Volume Mounts

- Backend source (`./backend/src`) is mounted, so changes hot-reload during development
- Frontend source (`./frontend/src`) is mounted similarly
- Data persists in `./backend/data/`

#### Health Checks

Both services include health checks. The frontend waits for the backend to be healthy before starting:

```bash
docker-compose up --build
# Check service health
docker-compose ps
```

### Production Deployment with Docker

#### Build the Backend Image

```bash
docker build -t stellar-bounty-board-backend:latest .
```

#### Run the Backend Container

```bash
docker run -d \
  -p 3001:3001 \
  -e SOROBAN_CONTRACT_ID=your-contract-id \
  -e SOROBAN_RPC_URL=https://rpc-futurenet.stellar.org \
  -v /path/to/data:/app/data \
  stellar-bounty-board-backend:latest
```

#### Build the Frontend Image

```bash
docker build -t stellar-bounty-board-frontend:latest ./frontend
```

#### Run the Frontend Container

```bash
docker run -d \
  -p 80:5173 \
  -e VITE_API_BASE_URL=https://your-backend.example.com/api \
  stellar-bounty-board-frontend:latest
```

### Environment Variables (Docker)

**Backend (`Dockerfile`):**

- `NODE_ENV` (default: `production`)
- `PORT` (default: `3001`)
- `SOROBAN_CONTRACT_ID` (required if indexing events)
- `SOROBAN_RPC_URL` (default: `https://rpc-futurenet.stellar.org`)

**Frontend (`frontend/Dockerfile`):**

- `VITE_API_BASE_URL` (required): URL of your backend API

### Health Check Paths (Docker)

- Backend: `GET http://localhost:3001/api/health`
- Frontend: `GET http://localhost:5173` (should load the React app)

### Docker Troubleshooting

**Container fails to start:**

- Check logs: `docker-compose logs backend` or `docker logs <container-id>`
- Ensure the root `package.json` and all dependencies are present

**API calls fail from frontend:**

- Verify `VITE_API_BASE_URL` is set correctly
- Ensure backend container is healthy: `docker-compose ps`
- Check CORS settings: set `ALLOWED_ORIGINS` to your deployed frontend URL when `NODE_ENV=production`

**Data not persisting:**

- Verify the volume mount path: `docker volume ls` and `docker volume inspect <volume-name>`
- Ensure the host directory has write permissions

**Port conflicts:**

- If ports 3001 or 5173 are in use, modify `docker-compose.yml`:
  ```yaml
  ports:
    - '3001:3001' # Change left side (host) port
  ```

---

## Need Help?

- Check the [ONBOARDING.md](../ONBOARDING.md) for local setup.
- See [RUNBOOK.md](../RUNBOOK.md) for common operational tasks and emergency procedures.
- Open an issue or discussion in the repo for deployment help.

---

## Wave and backlog context

Deployment-related work is tracked in the current wave backlog,
[`docs/wave-6.md`](wave-6.md), with earlier waves in
[`wave-5.md`](wave-5.md) and [`wave-4.md`](wave-4.md). [`wave-status.md`](wave-status.md)
reconciles all three against the live issue tracker — check it for what is still open
before picking up deployment work. Update this guide in the same PR when you change
deployment behaviour.
