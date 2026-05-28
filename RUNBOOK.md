# Operations Runbook

## Common Operational Tasks

### Restarting the Backend
\`\`\`bash
# If using Docker
docker-compose restart backend

# If using PM2
pm2 restart stellar-bounty-backend
\`\`\`

### Checking Logs
\`\`\`bash
# Docker
docker-compose logs -f backend

# PM2
pm2 logs stellar-bounty-backend
\`\`\`

### Clearing Cache
\`\`\`bash
# In-memory cache
curl -X POST http://localhost:3000/api/admin/cache/clear

# Docker volume reset
docker-compose down -v && docker-compose up -d
\`\`\`

### Database Backup
\`\`\`bash
# SQLite
cp data/bounties.db data/bounties.db.backup

# PostgreSQL
pg_dump stellar_bounties > backup.sql
\`\`\`

### Health Checks
\`\`\`bash
# API health endpoint
curl http://localhost:3000/api/health

# Full system check
curl http://localhost:3000/api/health/ready
\`\`\`

### Deployment Rollback
\`\`\`bash
# Railway
railway rollback

# Docker
docker-compose pull backend:previous-tag
docker-compose up -d backend
\`\`\`

## Alert Response

### High Error Rate
1. Check /api/health for system status
2. Review recent logs for error patterns
3. Check third-party dependencies (Stellar RPC, Soroban)
4. Scale up or restart affected services
