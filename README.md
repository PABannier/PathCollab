# PathCollab

[![CI](https://github.com/pabannier/pathcollab/actions/workflows/ci.yml/badge.svg)](https://github.com/pabannier/pathcollab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fpabannier%2Fpathcollab-blue)](https://ghcr.io/pabannier/pathcollab)

---

<div align="center">

![PathCollab, a self-hosted collaborative digital pathology viewer](./assets/pathcollab.png)

**Collaborative whole-slide image viewer with real-time cursor presence and overlay rendering**

```bash
docker run -p 8080:8080 -v /path/to/slides:/slides ghcr.io/pabannier/pathcollab:latest
```

Open **http://localhost:8080** → Share link → Collaborate instantly

</div>

---

## Why PathCollab?

**The Problem**: Pathologists and ML scientists need to review slides together—but they're in different cities. Current options force a brutal tradeoff:

| Option | Fast Rendering | Real-time Collab | AI Overlays | Setup Time |
|--------|:--------------:|:----------------:|:-----------:|:----------:|
| Local viewers (PathView, QuPath) | ✅ | ❌ | ⚠️ | Minutes |
| Screen sharing (Zoom, Teams) | ❌ Laggy | ⚠️ One-way | ❌ | Seconds |
| Enterprise pathology platforms | ✅ | ✅ | ✅ | Weeks + $$$$ |

**The Solution**: PathCollab is a **presenter-led collaborative viewer** where one host guides up to 20 followers through a whole-slide image. Everyone sees real-time cursors, can snap to the presenter's view, and overlay millions of AI-detected cells—all from a shareable link with **no accounts required**.

| Feature | What It Does |
|---------|--------------|
| **Zero-Auth Sessions** | Share a link, start collaborating. No logins, no invites, no IT tickets. Sessions auto-expire in 4 hours. |
| **Real-Time Presence** | See where everyone is looking—cursors update at 30Hz, viewports at 10Hz. "Follow me here..." actually works. |
| **Dual Overlay System** | Render tissue heatmaps (tile-based raster) and cell polygons (vector) simultaneously. WebGL2 handles 1M+ cells at 60fps with LOD. |
| **Snap to Presenter** | One click to jump to exactly what the presenter sees—smooth 300ms animation, not jarring teleport. |
| **Docker-Native** | Single `docker run` command. 150MB image. No nginx, no Redis, no docker-compose required. |

---

## Quick Example

```bash
# 1. Start PathCollab with your slides directory
docker run -p 8080:8080 -v ~/slides:/slides -v ~/overlays:/overlays ghcr.io/pabannier/pathcollab:latest

# 2. Open browser
open http://localhost:8080

# 3. Create a session
#    → Get a shareable link like: http://localhost:8080/s/k3m9p2qdx7#join=...

# 4. Share the link with colleagues
#    → They open it, instantly see the slide
#    → Their cursor appears on your screen (and yours on theirs)

# 5. Display cell/tissue overlay (presenter only)
#    → Load an overlay file
#    → Tissue heatmap tiles load on-demand as you pan/zoom
#    → Cell polygons render with automatic LOD (points → boxes → full polygons)

# 6. Use the Layers panel to toggle visibility
#    → Toggle tissue types (tumor, stroma, necrosis) independently
#    → Toggle cell types (cancer cells, lymphocytes, fibroblasts)
#    → Adjust overlay opacity with sliders

# 7. Followers click "Snap to Presenter" to jump to your view
```

**What it looks like:**

![PathCollab Home](./assets/pathcollab-home.png)


---

## How PathCollab Compares

| Capability | PathCollab | QuPath | ASAP Viewer | Commercial LIMS |
|------------|:----------:|:------:|:-----------:|:---------------:|
| Real-time multi-user | ✅ 20 users | ❌ | ❌ | ✅ |
| Cursor presence | ✅ 30Hz | ❌ | ❌ | ⚠️ Varies |
| Overlay rendering | ✅ WebGL2, 1M+ polygons | ✅ Local only | ⚠️ Limited | ✅ |
| Setup time | ✅ 30 seconds | ⚠️ 5 min | ⚠️ 5 min | ❌ Weeks |
| Self-hostable | ✅ Docker | ✅ | ✅ | ⚠️ Varies |
| Cost | ✅ Free | ✅ Free | ✅ Free | ❌ $10K+/year |

**When to use PathCollab:**
- Teaching sessions where a pathologist guides students through a case
- Remote tumor board reviews with distributed participants
- ML scientist demonstrating cell detection results to clinical collaborators
- Quick "can you look at this?" consultations without formal case submission

---

## Installation

### Docker (Recommended)

```bash
# Quick start — slides from local directory
docker run -p 8080:8080 -v /path/to/slides:/slides ghcr.io/pabannier/pathcollab:latest

# With persistent overlay cache
docker run -p 8080:8080 \
  -v /path/to/slides:/slides:ro \
  -v pathcollab-cache:/data \
  ghcr.io/pabannier/pathcollab:latest

# With custom configuration (check the full configuration options below)
docker run -p 8080:8080 \
  -v /path/to/slides:/slides:ro \
  -e MAX_FOLLOWERS=50 \
  -e SESSION_MAX_DURATION_HOURS=8 \
  ghcr.io/pabannier/pathcollab:latest
```

### Docker Compose (Production)

```yaml
# docker-compose.yml
services:
  pathcollab:
    image: ghcr.io/pabannier/pathcollab:latest
    ports:
      - "8080:8080"
    volumes:
      - /path/to/slides:/slides:ro
      - pathcollab-cache:/data
    environment:
      - RUST_LOG=pathcollab=info
      - MAX_FOLLOWERS=20
      - SESSION_MAX_DURATION_HOURS=4
    restart: unless-stopped

volumes:
  pathcollab-cache:
```

```bash
docker-compose up -d
```

### From Source

```bash
# Prerequisites: Rust 1.85+, Bun 1.3+, protobuf-compiler

# Clone
git clone https://github.com/pabannier/pathcollab.git
cd pathcollab

# Quick start (handles everything)
./scripts/dev-local.sh

# Or manually:
cd server && cargo build --release
cd ../web && bun install && bun run build
./target/release/pathcollab --slides-dir /path/to/slides
```

---

## Quick Start

### 1. Start the Server

```bash
docker run -p 8080:8080 -v ~/slides:/slides ghcr.io/pabannier/pathcollab:latest
```

Optionally, you can add overlays:

```bash
docker run -p 8080:8080 -v ~/slides:/slides -v ~/overlays:/overlays ghcr.io/pabannier/pathcollab:latest
```

### 2. Create a Session

1. Open http://localhost:8080
2. You're now the **presenter**

### 3. Share with Collaborators

1. Copy the link (includes a secret token in the URL fragment)
2. Send to colleagues via Slack, email, etc.
3. They open the link → instantly join as **followers**

### 4. Guide the Session

- **Pan/zoom** normally—followers see your cursor in real-time
- **Followers** can explore independently, then click **"Snap to Presenter"** to rejoin
- **Toggle overlays**

---

## Session Roles

| Role | How Assigned | Capabilities |
|------|--------------|--------------|
| **Presenter** | First user to create/join | Upload overlays, toggle layer visibility, set view for "snap" |
| **Follower** | Subsequent joiners | View slide, see cursors, explore independently, snap to presenter |

The presenter's viewport is broadcast at 10Hz. Followers can wander off but always have a "home base" to return to.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `pathcollab=info,tower_http=info` | Log level (trace/debug/info/warn/error) |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8080` | Server port |
| `SLIDES_DIR` | `/slides` | Directory containing WSI files |
| `MAX_FOLLOWERS` | `20` | Maximum followers per session |
| `SESSION_MAX_DURATION_HOURS` | `4` | Session auto-expiry time |
| `PRESENTER_GRACE_PERIOD_SECS` | `30` | Time before session ends after presenter disconnects |
| `OVERLAY_MAX_SIZE_MB` | `500` | Maximum overlay file size |
| `OVERLAY_CACHE_DIR` | `/var/lib/pathcollab/overlays` | Overlay cache directory |
| `OVERLAY_CACHE_MAX_GB` | `50` | Maximum cache size before eviction |

### Supported Slide Formats

PathCollab reads slides via [OpenSlide](https://openslide.org/). Supported formats:

| Format | Extension | Vendor |
|--------|-----------|--------|
| Aperio SVS | `.svs` | Leica |
| Hamamatsu | `.ndpi`, `.vms` | Hamamatsu |
| Leica SCN | `.scn` | Leica |
| MIRAX | `.mrxs` | 3DHistech |
| Generic tiled TIFF | `.tif`, `.tiff` | Various |
| Ventana BIF | `.bif` | Roche |
| Philips TIFF | `.tiff` | Philips |

### Overlay Protobuf Format

PathCollab expects overlays in a specific protobuf format:

```protobuf
// See server/proto/overlays.proto for full schema
message SlideSegmentationData {
  string slide_id = 1;
  string slide_path = 2;
  float mpp = 3;                           // Microns per pixel
  int32 max_level = 4;
  string cell_model_name = 5;
  string tissue_model_name = 6;
  repeated TileSegmentationData tiles = 7;
  map<int32, string> tissue_class_mapping = 8;
}

message TileSegmentationData {
  string tile_id = 1;
  int32 level = 2;
  int32 x = 3;
  int32 y = 4;
  int32 width = 5;
  int32 height = 6;
  repeated SegmentationPolygon masks = 7;  // Cell polygons
  TissueSegmentationMap tissue_segmentation_map = 8;
}

message SegmentationPolygon {
  string cell_id = 1;
  string cell_type = 2;
  float confidence = 3;
  repeated Point coordinates = 4;          // Polygon boundary
  Point centroid = 5;
}

message TissueSegmentationMap {
  int32 width = 1;
  int32 height = 2;
  bytes data = 3;                          // Zlib-compressed class indices
}
```

---

## API Reference

### WebSocket Protocol

Connect to `/ws` for real-time communication. Messages are JSON.

#### Client → Server

```typescript
// Create a new session
{ "type": "create_session", "slide_id": "slide-001", "seq": 1 }

// Join an existing session
{ "type": "join_session", "session_id": "abc123", "join_secret": "...", "seq": 2 }

// Update cursor position (30Hz)
{ "type": "cursor_update", "x": 1000, "y": 2000, "seq": 3 }

// Update viewport (presenter: 10Hz, follower: 2Hz)
{ "type": "viewport_update", "center_x": 5000, "center_y": 5000, "zoom": 0.5, "seq": 4 }

// Toggle layer visibility (presenter only)
{ "type": "layer_update", "visibility": { "cell_polygons_visible": true, ... }, "seq": 5 }

// Update tissue overlay state (presenter only)
{ "type": "tissue_overlay_update", "enabled": true, "opacity": 0.7, "visible_tissue_types": [0, 1, 2], "seq": 6 }

// Keepalive
{ "type": "ping", "seq": 7 }
```

#### Server → Client

```typescript
// Session created (returns secrets)
{ "type": "session_created", "session": {...}, "join_secret": "...", "presenter_key": "..." }

// Someone joined
{ "type": "participant_joined", "participant": { "id": "...", "name": "Swift Falcon", "color": "#3B82F6" } }

// Cursor positions (batched, 30Hz)
{ "type": "presence_delta", "changed": [...], "removed": [...], "server_ts": 1234567890 }

// Presenter viewport (10Hz)
{ "type": "presenter_viewport", "viewport": { "center_x": 5000, "center_y": 5000, "zoom": 0.5 } }

// Overlay ready
{ "type": "overlay_loaded", "overlay": {...}, "overlay_order": ["overlay-1"] }

// Presenter tissue overlay state (followers receive this)
{ "type": "presenter_tissue_overlay", "enabled": true, "opacity": 0.7, "visible_tissue_types": [0, 1, 2] }

// Keepalive response
{ "type": "pong" }
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (returns 200 if healthy) |
| `GET` | `/metrics` | JSON metrics |
| `GET` | `/metrics/prometheus` | Prometheus-format metrics |
| `GET` | `/dzi/slide/:id.dzi` | DZI metadata for OpenSeadragon |
| `GET` | `/dzi/slide/:id_:z_:x_:y.jpg` | Slide tile JPEG |
| `GET` | `/api/slide/:id/overlays` | List available overlays for slide |
| `GET` | `/api/slide/:id/overlay/metadata` | Cell overlay metadata (bounds, classes) |
| `GET` | `/api/slide/:id/overlay/cells?x=&y=&width=&height=` | Cell polygons in viewport region |
| `GET` | `/api/slide/:id/overlay/tissue/metadata` | Tissue overlay metadata (tile grid, classes) |
| `GET` | `/api/slide/:id/overlay/tissue/:level/:x/:y` | Raw tissue tile (zlib-decompressed class indices) |

---

## Troubleshooting

### "Tiles not loading"

```bash
# Check server can read slides directory
docker exec -it <container> ls -la /slides

# Check server logs
docker logs <container> 2>&1 | grep -i error

# Verify slide format is supported
file /path/to/your/slide.svs
```

### "WebSocket connection failed"

```bash
# Check server is running
curl http://localhost:8080/health

# Check for port conflicts
lsof -i :8080

# If behind reverse proxy, ensure WebSocket upgrade headers:
# Upgrade: websocket
# Connection: upgrade
```

### "Overlay not loading / tiles missing"

```bash
# Check file size (max 500MB by default)
ls -lh overlay.pb

# Check server logs for parsing errors
docker logs <container> 2>&1 | grep -i overlay

# Verify protobuf format matches expected schema
protoc --decode=SlideSegmentationData server/proto/overlays.proto < overlay.pb

# Check tissue tile endpoint directly
curl -v "http://localhost:8080/api/slide/<id>/overlay/tissue/0/0/0"
```

### "Overlay colors look wrong"

The tissue overlay uses a predefined color palette. Verify your `tissue_class_mapping` in the protobuf matches expected class indices (0-15). Check browser console for WebGL errors—some browsers have stricter texture format requirements.

### "Cursors are laggy"

- Check network latency: `ping <server-ip>`
- If > 100ms, latency is network-bound (expected behavior)
- If < 50ms but still laggy, check browser dev tools for WebSocket backpressure

### "Session expired unexpectedly"

Sessions expire after 4 hours (configurable via `SESSION_MAX_DURATION_HOURS`). If the presenter disconnects, followers have a 30-second grace period before the session ends.

---

## Limitations

- **Max 20 followers per session**: WebSocket fan-out becomes expensive beyond this
- **4-hour session limit**: Prevents resource leaks; can be increased via config
- **500MB overlay limit**: Server memory bounded; larger files need chunked processing
- **WebGL2 required**: Falls back to Canvas2D but performance degrades significantly
- **No persistence**: Sessions and overlays are ephemeral (by design)

---

## FAQ

### Is my slide data sent to external servers?

**No.** PathCollab is fully **self-hosted**. Your slides stay on your server. The only network traffic is between your server and your users' browsers.

### Can I use this for clinical diagnosis?

PathCollab is intended for **education, research, and informal consultation**. It doesn't have audit trails, formal case management, or regulatory compliance features required for clinical sign-off. Use your validated LIMS for that.

### Why ephemeral sessions instead of persistent rooms?

1. **Simplicity**: No user accounts, no database, no state to manage
2. **Security**: Links auto-expire; no orphaned sessions with sensitive data
3. **Use case fit**: Tumor boards and teaching sessions are inherently time-bounded

### How do I add more than 20 followers?

Increase `MAX_FOLLOWERS` env var. Be aware this increases server memory and WebSocket fan-out load. Test before deploying to production.

```bash
docker run -e MAX_FOLLOWERS=50 ...
```

---

## Development

### Quick Start

```bash
./scripts/dev-local.sh
```

This handles dependency checks, builds, and starts both backend and frontend.

### Manual Setup

```bash
# Backend (Rust)
cd server
sudo apt-get install protobuf-compiler  # Ubuntu/Debian
cargo run

# Frontend (React)
cd web
bun install
bun run dev

# Tests
cargo test              # Backend
bun run test           # Frontend unit tests
bun run test:e2e       # Playwright E2E tests
```

---

## Contributing

Contributions welcome! Please:

1. Open an issue to discuss before large PRs
2. Follow existing code style (Prettier, rustfmt)
3. Add tests for new functionality
4. Update docs if behavior changes

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

[Report Bug](https://github.com/pabannier/pathcollab/issues) · [Request Feature](https://github.com/pabannier/pathcollab/issues) · [Documentation](docs/)

</div>
