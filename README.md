# PathCollab

A web-based collaborative viewer for digital pathology, enabling real-time multi-user sessions for viewing and annotating whole-slide images (WSI) with AI-generated overlays.

## Features

- **Real-time Collaboration**: Presenter-led sessions with up to 20 concurrent followers
- **Cursor Presence**: See where other participants are looking in real-time
- **Viewport Sync**: Followers can snap to the presenter's view with smooth animations
- **AI Overlay Support**: Upload and visualize cell segmentation and tissue classification from protobuf files
- **WebGL2 Rendering**: High-performance rendering of millions of polygons
- **Zero-Auth Sessions**: Ephemeral shareable links with no account required
- **Docker-Native**: Single `docker run` command to start everything

## Quick Start

### Prerequisites

- Docker 20.10+
- 4GB RAM minimum (8GB recommended for large overlays)

### Single Command Deployment (Recommended)

The simplest way to run PathCollab - a single Docker image with everything included:

```bash
# Run PathCollab with your slides directory
docker run -p 8080:8080 -v /path/to/your/slides:/slides ghcr.io/pabannier/pathcollab:latest
```

Open your browser to **http://localhost:8080** - that's it!

The unified image (~150MB) contains both the React frontend and Rust backend. No nginx, no docker-compose, no configuration required.

#### Options

```bash
# With persistent overlay cache
docker run -p 8080:8080 \
  -v /path/to/slides:/slides:ro \
  -v pathcollab-cache:/data \
  ghcr.io/pabannier/pathcollab:latest

# With custom configuration
docker run -p 8080:8080 \
  -v /path/to/slides:/slides:ro \
  -e MAX_FOLLOWERS=50 \
  -e SESSION_MAX_DURATION_HOURS=8 \
  ghcr.io/pabannier/pathcollab:latest
```

### Stopping the Server

```bash
docker stop <container-id>
```

## Configuration

### Environment Variables

Copy the example environment file and customize as needed:

```bash
cp .env.example .env
```

#### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `pathcollab=info,tower_http=info` | Log level configuration |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8080` | Server port |
| `SLIDES_DIR` | `/slides` | Directory containing WSI files |
| `STATIC_FILES_DIR` | `/app/static` (Docker) | Frontend static files directory (unified image only) |

#### Session Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_FOLLOWERS` | `20` | Maximum followers per session |
| `SESSION_MAX_DURATION_HOURS` | `4` | Session expiry time |
| `PRESENTER_GRACE_PERIOD_SECS` | `30` | Time before session ends after presenter disconnects |

#### Overlay Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OVERLAY_MAX_SIZE_MB` | `500` | Maximum overlay file size |
| `OVERLAY_CACHE_DIR` | `/var/lib/pathcollab/overlays` | Overlay cache directory |
| `OVERLAY_CACHE_MAX_GB` | `50` | Maximum cache size |

### Slides Directory

Place your whole-slide images in the `data/slides` directory. Supported formats depend on your WSIStreamer configuration but typically include:
- Aperio SVS (.svs)
- Hamamatsu (.ndpi, .vms)
- Leica (.scn)
- MIRAX (.mrxs)
- Generic tiled TIFF

## Usage

### Creating a Session

1. Navigate to the home page
2. Click "Create Session" or "Try Demo"
3. Select a slide from the available list
4. Share the generated URL with collaborators

### Session Roles

- **Presenter**: First user to create or join a session. Can upload overlays, control layer visibility, and lead navigation.
- **Follower**: Subsequent users who join. Can view the slide, see the presenter's cursor and viewport, and explore independently.

### Overlay Files

PathCollab supports protobuf overlay files containing:
- **Tissue segmentation**: Heatmap tiles with class predictions
- **Cell detection**: Polygon boundaries with class labels and confidence scores

The protobuf schema is defined in `server/proto/overlay.proto`.

## Development

> **Environment Guide**: See [docs/ENV_MATRIX.md](docs/ENV_MATRIX.md) for detailed differences between development, Docker, and production environments.

### Quick Start

The fastest way to start developing:

```bash
./scripts/dev-local.sh
```

This single command:
- Checks for required dependencies (Rust, Bun)
- Creates data directories (./data/slides, ./data/overlays)
- Builds and starts the backend
- Starts the frontend dev server

No external services required. Open http://localhost:3000 when ready.

### Prerequisites

- Rust 1.85+ with protobuf-compiler
- Bun 1.3+ (or Node.js 20+)

### Backend Development

```bash
cd server

# Install protobuf compiler (Ubuntu/Debian)
sudo apt-get install protobuf-compiler

# Run the server
cargo run

# Run tests
cargo test

# Format and lint
cargo fmt && cargo clippy
```

### Frontend Development

```bash
cd web

# Install dependencies
bun install

# Start development server
bun run dev

# Run tests
bun run test

# Build for production
bun run build
```

### Running E2E Tests

```bash
cd web

# Install Playwright browsers
bun run test:e2e:install

# Run E2E tests
bun run test:e2e
```

## Architecture

```
                    ┌─────────────────┐
                    │    Clients      │
                    │  (React + OSD)  │
                    └────────┬────────┘
                             │ HTTPS + WebSocket
                             ▼
                    ┌─────────────────┐
                    │  Reverse Proxy  │
                    │  (nginx/Caddy)  │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ PathCollab │  │ PathCollab │  │WSIStreamer │
     │  Frontend  │  │   Server   │  │ Tile Server│
     │   (React)  │  │   (Rust)   │  │            │
     └────────────┘  └────────────┘  └──────┬─────┘
                                            │
                                            ▼
                                    ┌────────────┐
                                    │  S3/Local  │
                                    │   Slides   │
                                    └────────────┘
```

### Key Components

- **Session Manager**: Handles session lifecycle, participant tracking, and role assignment
- **Presence Engine**: Aggregates cursor positions and viewport updates at 30Hz/10Hz
- **Overlay Manager**: Parses protobuf files, builds spatial indices, serves tiles
- **WebSocket Gateway**: Connection management, message routing, broadcast

## Deployment

### Production Recommendations

1. **TLS Termination**: Use Caddy, nginx, or a cloud load balancer for HTTPS
2. **Sticky Sessions**: Required for WebSocket connections in multi-instance deployments
3. **Session Persistence**: Configure Redis for session state to survive restarts
4. **Monitoring**: Add Prometheus metrics endpoint and Grafana dashboards

### Example Production docker-compose.yml

```yaml
services:
  web:
    image: pathcollab/web:latest
    restart: always

  server:
    image: pathcollab/server:latest
    environment:
      - RUST_LOG=pathcollab=info
      - REDIS_URL=redis://redis:6379
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: always

  wsistreamer:
    image: ghcr.io/wsistreamer/wsistreamer:latest
    volumes:
      - /path/to/slides:/slides:ro
    restart: always

volumes:
  redis-data:
```

### Reverse Proxy Configuration (Caddy)

```caddyfile
pathcollab.example.com {
    handle /ws {
        reverse_proxy server:8080
    }

    handle /api/* {
        reverse_proxy server:8080
    }

    handle {
        reverse_proxy web:80
    }
}
```

## API Reference

### WebSocket Protocol

Connect to `/ws` for real-time communication. Messages are JSON-encoded.

#### Client Messages

```typescript
// Create a new session
{ "type": "create_session", "slide_id": "slide-001", "seq": 1 }

// Join an existing session
{ "type": "join_session", "session_id": "abc123", "join_secret": "...", "seq": 2 }

// Update cursor position
{ "type": "cursor_update", "x": 1000, "y": 2000, "seq": 3 }

// Update viewport (presenter only)
{ "type": "viewport_update", "center_x": 5000, "center_y": 5000, "zoom": 0.5, "seq": 4 }
```

#### Server Messages

```typescript
// Session created (presenter only)
{ "type": "session_created", "session": {...}, "join_secret": "...", "presenter_key": "..." }

// Participant joined
{ "type": "participant_joined", "participant": {...} }

// Presence updates (30Hz aggregated)
{ "type": "presence_delta", "changed": [...], "removed": [...], "server_ts": 1234567890 }

// Presenter viewport (10Hz)
{ "type": "presenter_viewport", "viewport": {...} }
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check endpoint |
| `POST` | `/api/overlay/upload?session_id=...` | Upload overlay protobuf |
| `GET` | `/api/overlay/:id/manifest` | Get overlay manifest |
| `GET` | `/api/overlay/:id/raster/:z/:x/:y` | Get raster tile |
| `GET` | `/api/overlay/:id/vec/:z/:x/:y` | Get vector chunk |

## Troubleshooting

### Common Issues

**Tiles not loading**
- Verify slide files are in `data/slides` directory
- Check server logs: `docker-compose logs -f server`
- Ensure OpenSlide is installed in the server container
- Check browser console for errors

**WebSocket connection fails**
- Ensure server is running: `curl http://localhost:8080/health`
- Check nginx/proxy configuration for WebSocket upgrade headers

**Overlay upload fails**
- Check file size is under 500MB limit
- Verify protobuf format matches expected schema
- Check server logs for parsing errors

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f server
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to the main branch.
