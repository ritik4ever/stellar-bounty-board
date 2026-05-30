

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



   | Variable | Required | Example Value | Description |
   |----------|----------|---------------|-------------|
   | `GITHUB_WEBHOOK_SECRET` | ✅ Yes | `your_webhook_secret` | Secret for GitHub webhook verification |
   | `NODE_ENV` | ❌ No | `production` | Environment mode |
   | `CORS_ORIGINS` | ❌ No | `https://your-frontend.vercel.app` | Allowed CORS origins |
   | `BOUNTY_STORE_PATH` | ❌ No | `./data/bounties.json` | Bounty data file (default) |
   | `BOUNTY_AUDIT_STORE_PATH` | ❌ No | `./data/audit.json` | Audit log file (default) |
   | `LOG_LEVEL` | ❌ No | `info` | Logging level |


---

## Required Environment Variables



---

## Health Check Paths

- Backend: `/api/health` (should return `{ "status": "ok", ... }`)
- Frontend: `/` (should load the React dashboard)

---

## Common Deployment Issues & Fixes

- **Build fails:** Check Node.js version (18+), install all dependencies, and verify build commands.
- **API not reachable:** Confirm backend is live and CORS is configured.

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
- Check CORS settings in the backend

**Data not persisting:**
- Verify the volume mount path: `docker volume ls` and `docker volume inspect <volume-name>`
- Ensure the host directory has write permissions

**Port conflicts:**
- If ports 3001 or 5173 are in use, modify `docker-compose.yml`:
  ```yaml
  ports:
    - "3001:3001"  # Change left side (host) port
  ```

---

## Need Help?

- Check the [ONBOARDING.md](../ONBOARDING.md) for local setup.
- See [RUNBOOK.md](../RUNBOOK.md) for common operational tasks and emergency procedures.
- Open an issue or discussion in the repo for deployment help.
