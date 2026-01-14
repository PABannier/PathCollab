# Environment Matrix

This document describes the differences between development, local Docker, and production environments for PathCollab.

## Quick Reference

| Setting | Dev (`bun run dev`) | Local Docker | Production |
|---------|---------------------|--------------|------------|
| **Frontend URL** | http://localhost:5173 | http://localhost:3000 | https://app.example.com |
| **Backend URL** | http://localhost:8080 | http://localhost:8080 | Internal to container |
| **WebSocket URL** | ws://localhost:8080/ws | ws://localhost:8080/ws | wss://app.example.com/ws |
| **Tile Serving** | Via Vite proxy | Direct | Via nginx |
| **Slides Dir** | ./data/slides | /slides (mounted) | /slides (volume) |
| **Overlay Cache** | ./data/overlays | /var/lib/pathcollab/overlays | Volume mount |
| **CORS** | Not needed (proxy) | Not needed (proxy) | Not needed (proxy) |
| **Hot Reload** | Yes | No | No |

## Environment Details

### Development Mode (`bun run dev` + `cargo run`)

**Best for**: Active development, debugging, quick iteration

**Quick Start**:
```bash
# Terminal 1: Start backend
cd server && cargo run

# Terminal 2: Start frontend
cd web && bun run dev

# Or use the convenience script:
./scripts/dev-local.sh
```

**URLs**:
- Frontend: http://localhost:5173 (Vite dev server with HMR)
- Backend: http://localhost:8080 (Rust Axum server)
- WebSocket: ws://localhost:8080/ws

**Configuration**:
- Vite proxies `/api/*` requests to the backend
- No CORS configuration needed
- Hot module replacement enabled
- Source maps available
- `VITE_SOLO_MODE=true` for debugging without WebSocket

**Data Paths**:
```
./data/slides/      # Place WSI files here
./data/overlays/    # Overlay cache (auto-created)
```

**Environment Variables** (optional):
```bash
# server/.env (or exported)
RUST_LOG=pathcollab=debug,tower_http=debug
HOST=0.0.0.0
PORT=8080
SLIDES_DIR=./data/slides
OVERLAY_CACHE_DIR=./data/overlays
```

### Local Docker (`docker-compose up`)

**Best for**: Testing production-like setup, running without dev tools installed

**Quick Start**:
```bash
# Create slides directory
mkdir -p data/slides

# Start all services
docker-compose up -d

# Check health
./scripts/check-health.sh
```

**URLs**:
- Frontend: http://localhost:3000 (Nginx)
- Backend: http://localhost:8080 (Rust Axum server)
- WebSocket: ws://localhost:8080/ws

**Configuration**:
- Frontend served by Nginx (production build)
- Backend runs inside container
- Slides mounted from `./data/slides`
- Health checks configured in docker-compose.yml

**Data Paths** (inside containers):
```
/slides              # Mounted from ./data/slides (read-only)
/var/lib/pathcollab/overlays  # Overlay cache (container volume)
```

**Environment Variables**:
```yaml
# docker-compose.yml (already configured)
RUST_LOG=pathcollab=info,tower_http=info
SLIDE_SOURCE=local
SLIDES_DIR=/slides
```

### Production (Kubernetes/ECS/Cloud)

**Best for**: Real deployments with TLS, scaling, monitoring

**Architecture**:
```
              Internet
                 │
                 ▼
         ┌─────────────┐
         │ Load Balancer│  (TLS termination)
         └─────┬───────┘
               │
         ┌─────┴─────┐
         │           │
    ┌────▼────┐ ┌────▼────┐
    │  Web    │ │ Server  │
    │ (nginx) │ │ (Rust)  │
    └─────────┘ └────┬────┘
                     │
              ┌──────┴──────┐
              │             │
         ┌────▼────┐  ┌─────▼────┐
         │  Slides │  │  Redis   │
         │ (Volume)│  │ (Session)│
         └─────────┘  └──────────┘
```

**URLs**:
- Frontend: https://your-domain.com
- WebSocket: wss://your-domain.com/ws
- Backend: Internal only (via Kubernetes service)

**Key Differences from Local**:
- TLS termination at load balancer
- Redis for session persistence (survives restarts)
- Sticky sessions required for WebSocket connections
- Health checks for liveness/readiness probes
- Proper logging and monitoring setup

**Environment Variables**:
```bash
RUST_LOG=pathcollab=info
BEHIND_PROXY=true
PUBLIC_BASE_URL=https://your-domain.com
REDIS_URL=redis://redis:6379
SLIDES_DIR=/slides
OVERLAY_CACHE_DIR=/var/lib/pathcollab/overlays
```

## Common Pitfalls

### Development

| Issue | Cause | Solution |
|-------|-------|----------|
| "Connection refused" to backend | Backend not running | Start `cargo run` in server/ |
| CORS errors | Wrong proxy config | Check `web/vite.config.ts` proxy settings |
| Tiles not loading | Empty slides directory | Add WSI files to `./data/slides` |

### Local Docker

| Issue | Cause | Solution |
|-------|-------|----------|
| Port conflict on 3000 | Another service using port | Stop conflicting service or change port |
| Container won't start | Missing slides directory | `mkdir -p data/slides` |
| Health check fails | Service not ready | Wait 10-15 seconds, check `docker-compose logs` |

### Production

| Issue | Cause | Solution |
|-------|-------|----------|
| WebSocket disconnects | Missing sticky sessions | Enable session affinity in load balancer |
| Session lost on restart | No Redis configured | Add `REDIS_URL` configuration |
| Links show wrong host | Missing PUBLIC_BASE_URL | Set `PUBLIC_BASE_URL` to your domain |

## Verifying Your Setup

Use the health check script to verify services are running:

```bash
# Check immediately
./scripts/check-health.sh

# Wait for services to start
./scripts/check-health.sh --wait

# Custom URLs
BACKEND_URL=http://myhost:8080 ./scripts/check-health.sh
```

## See Also

- [QUICKSTART.md](../QUICKSTART.md) - Fast setup instructions
- [README.md](../README.md) - Full documentation
- [.env.example](../.env.example) - All configuration options
