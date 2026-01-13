# PathCollab: Implementation Plan

## Executive Summary

### Problem Statement

Digital pathology workflows increasingly require real-time collaboration between geographically distributed pathologists and ML scientists. Current solutions force users to choose between:

1. **High-performance local viewers** (like PathView) that offer fast rendering but no collaboration
2. **Web-based collaboration tools** that sacrifice rendering performance, cannot handle million-polygon overlays, or require complex authentication setups

PathCollab bridges this gap: a web-based collaborative viewer built for **presenter-led sessions** where one host guides up to 20 followers through a whole-slide image, with real-time cursor presence, synchronized viewports, and **hybrid overlay rendering** (cacheable raster overlay tiles for overview + vector detail on demand).

The philosophy is **simplicity over features**: display slides fast, show where people are looking, render AI-generated overlays. Nothing more.

### Key Innovations

| Innovation | Description | Impact |
|------------|-------------|--------|
| **Hybrid Overlay Rendering** | Serve overlay as HTTP-cacheable raster tiles for overview; stream vector cells only when zoomed-in / interacting | Predictable performance across browsers; graceful fallback when WebGL2 is flaky |
| **Server-Side Protobuf Processing** | Rust backend parses and spatially indexes `.pb` files, streams viewport-relevant data to clients | Sub-second overlay loading for 300MB files; minimal client memory footprint |
| **Ephemeral Zero-Auth Sessions** | Shareable links with automatic cleanup; no accounts required | Friction-free sharing for demos, teaching, consultations |
| **Unlisted Join Tokens + Presenter Key** | Secrets are carried in the URL fragment (not sent to servers via HTTP); presenter actions require a separate key | Prevents casual guessing + avoids secrets in logs/referrers |
| **Hierarchical State Sync** | Different sync frequencies for cursors (30Hz), viewports (10Hz), and layer state (on-change) | Optimal bandwidth usage across variable network conditions |
| **Docker-Native Deployment** | Single `docker-compose.yml` bundles PathCollab + WSIStreamer + S3 config | Self-host in under 5 minutes |

**Overlay strategy (new):**
- **Raster overlay tiles (HTTP):** tissue heatmaps + optional cell-density/outline layers, cacheable and retryable
- **Vector detail (WS/HTTP):** only for close zoom / hover / selection

---

## 1. Core Architecture

### 1.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENTS                                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Presenter     │  │   Follower 1    │  │   Follower N    │                  │
│  │   (React App)   │  │   (React App)   │  │   (React App)   │                  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                    │                            │
│           │ HTTPS + WebSocket (same origin, same port; WS upgrade)               │
└───────────┼────────────────────┼────────────────────┼────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           REVERSE PROXY (Caddy/Nginx)                            │
│  • TLS termination    • WS upgrade    • gzip/br    • cache headers for /overlay/*│
└─────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PATHCOLLAB SERVER (Rust)                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         WebSocket Gateway                                  │   │
│  │  • Connection management     • Message routing     • Rate limiting        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│           │                    │                    │                            │
│           ▼                    ▼                    ▼                            │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐                   │
│  │ Session Manager│   │ Presence Engine│   │ Overlay Manager│                   │
│  │ • Create/join  │   │ • Cursor agg.  │   │ • PB parsing   │                   │
│  │ • Role assign  │   │ • Viewport sync│   │ • Spatial index│                   │
│  │ • Lifecycle    │   │ • 30Hz/10Hz    │   │ • Tile queries │                   │
│  └────────────────┘   └────────────────┘   └────────────────┘                   │
│           │                                         │                            │
│           ▼                                         ▼                            │
│  ┌────────────────┐                        ┌─────────────────────────┐          │
│  │  Session Store │                        │ Overlay Store            │          │
│  │  (In-Memory)   │                        │ (disk-backed + mmap)     │          │
│  └────────────────┘                        │ • chunked by (z,x,y)     │          │
│                                            │ • hot metadata in RAM     │          │
│                                            │ • explicit budgets/evict  │          │
│                                            └─────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────────┘
            │
            │ HTTP (tile requests proxied or direct; recommend proxied for same-origin)
            ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              WSIStreamer                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Tile Server (port 3000)                           │   │
│  │  • DZI-compatible endpoints    • Tile caching    • S3 backend            │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                           │
│                                      ▼                                           │
│                             ┌────────────────┐                                  │
│                             │   S3 Bucket    │                                  │
│                             │  (SVS files)   │                                  │
│                             └────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Cognitive Model

The user mental model for PathCollab is intentionally simple:

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER MENTAL MODEL                           │
│                                                                 │
│   "I'm looking at a slide with others"                         │
│                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │   SLIDE     │    │   PEOPLE    │    │   LAYERS    │        │
│   │             │    │             │    │             │        │
│   │ • Pan/zoom  │    │ • Cursors   │    │ • Cells     │        │
│   │ • Tiles     │    │ • "Where    │    │ • Tissue    │        │
│   │ • Minimap   │    │   are they" │    │ • On/Off    │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
│   Actions:                                                      │
│   • Presenter: Move around, load overlays, toggle layers       │
│   • Follower:  Watch, explore independently, snap back         │
│   • Presenter: Laser pointer (momentary) + optional callout pin │
│   • Followers: Click callout pin to jump                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key cognitive principles:**
- **No modes**: Users don't switch between "view mode" and "collaborate mode"
- **Presence is ambient**: Cursors and viewport indicators are always visible, never requiring explicit action
- **Layers are familiar**: Photoshop-style layer panel maps to existing user knowledge
- **Follow is opt-in**: Followers aren't locked; they choose when to sync

### 1.3 Data Flow Pipeline

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW PIPELINE                                  │
└──────────────────────────────────────────────────────────────────────────────┘

TILE FLOW (Read-only, cacheable)
═══════════════════════════════════════════════════════════════════════════════

  Client Viewport Change
          │
          ▼
  ┌───────────────┐     HTTP GET        ┌───────────────┐
  │ OpenSeadragon │ ──────────────────► │  WSIStreamer  │
  │ Tile Manager  │ ◄────────────────── │  /tile/{z}/{x}/{y}
  └───────────────┘     JPEG/PNG        └───────────────┘


OVERLAY FLOW (Upload once, stream on-demand)
═══════════════════════════════════════════════════════════════════════════════

  Collaborator uploads .pb file (resumable chunks + checksum)
          │
          ▼ HTTP POST (chunk N) / HTTP PUT (chunk N) / finalize
  ┌───────────────┐                     ┌───────────────┐
  │    Client     │ ──────────────────► │ PathCollab    │
  │               │                     │ Server        │
  └───────────────┘                     └───────┬───────┘
                                                │
                         ┌──────────────────────┼──────────────────────┐
                         │                      │                      │
                         ▼                      ▼                      ▼
                  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
                  │ Parse Proto │       │ Build Tile  │       │ Extract     │
                  │ (prost)     │       │ Bin Index   │       │ Metadata    │
                  └─────────────┘       └─────────────┘       └─────────────┘
                                          (R-tree optional for ROI selection)
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │  Overlay Store   │
                                       │  (session-scoped)│
                                       └─────────────────┘
                                                │
          ┌─────────────────────────────────────┼─────────────────────────────┐
          │                                     │                             │
          ▼                                     ▼                             ▼
  ┌───────────────┐                     ┌───────────────┐             ┌───────────────┐
  │  Presenter    │ ◄── WS: overlay_loaded ──────────────────────────►│  Follower N   │
  │               │                     │  Follower 1   │             │               │
  └───────────────┘                     └───────────────┘             └───────────────┘

  On viewport change:
          │
          ├──────────────────────────────────────────────────────────────┐
          │ HTTP GET (cacheable overlay tiles)                            │
          ▼                                                              ▼
  /overlay/{overlay_id}/tile/{z}/{x}/{y}.webp (ETag, Cache-Control: immutable)   (optional) WS: request_vector_detail
  ┌───────────────┐                     ┌───────────────┐
  │    Client     │ ──────────────────► │ PathCollab    │
  │               │                     │ Server        │
  │               │ ◄────────────────── │ (tile store / index)│
  └───────────────┘   WS: overlay_data  └───────────────┘
                      (binary msgpack)


PRESENCE FLOW (High-frequency, small payloads)
═══════════════════════════════════════════════════════════════════════════════

  Every 33ms (30Hz):
  ┌───────────────┐                     ┌───────────────┐
  │    Client     │ ── cursor_update ─► │ PathCollab    │
  │               │                     │ Server        │
  └───────────────┘                     └───────┬───────┘
                                                │
                                                │ Aggregate all cursors
                                                │ in session
                                                ▼
                                       ┌─────────────────┐
                                       │   Broadcast     │
                                       │ presence_delta  │
                                       │ (only changes)  │
                                       └─────────────────┘

  Every 100ms (10Hz):
  ┌───────────────┐                     ┌───────────────┐
  │  Presenter    │ ─ viewport_update ► │ PathCollab    │
  │               │                     │ Server        │
  └───────────────┘                     └───────┬───────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │   Broadcast     │
                                       │ presenter_viewport
                                       │ (followers only)│
                                       └─────────────────┘


LAYER STATE FLOW (Low-frequency, on-change only)
═══════════════════════════════════════════════════════════════════════════════

  Presenter toggles layer:
  ┌───────────────┐                     ┌───────────────┐
  │  Presenter    │ ─ layer_update ───► │ PathCollab    │
  │               │                     │ Server        │
  └───────────────┘                     └───────┬───────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │   Broadcast     │
                                       │ layer_state     │
                                       │ (all clients)   │
                                       └─────────────────┘
```

### 1.4 Seven Design Principles

| # | Principle | Rationale | Implementation |
|---|-----------|-----------|----------------|
| **1** | **Tiles are sacred** | Tile rendering latency directly impacts perceived performance; never block on overlay operations | OpenSeadragon manages tiles independently; overlay WebGL layer is separate canvas |
| **2** | **Server owns truth** | Distributed state is hard; server is authoritative for session state, overlay data, layer visibility | Clients are thin; all state changes go through server and are broadcast back |
| **3** | **Bandwidth is variable** | Global users have 10ms-500ms latency; design for graceful degradation | Cursor updates are small (32 bytes); overlay data is streamed incrementally; viewport sync tolerates jitter |
| **4** | **Overlays are ephemeral but cacheable** | Default is ephemeral UX; derived artifacts should be restart-safe for reliability | Disk-backed content-addressed overlay cache + memory-mapped chunks; optional Redis only for multi-instance |
| **5** | **Progressive disclosure** | Don't overwhelm users; show complexity only when needed | Sidebar collapsed by default; cell hover info appears on demand; minimap shows viewport bounds subtly |
| **6** | **Fail gracefully** | Network issues shouldn't crash the app or corrupt state | Reconnection logic with exponential backoff; optimistic UI with rollback; presenter grace period |
| **7** | **One command deploy** | Adoption depends on ease of setup; Docker abstracts infra + TLS complexity | `docker-compose up` starts everything; reverse proxy provides HTTPS + WS upgrade |

---

## 2. Data Models

### 2.1 Session Schema

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// SESSION DOMAIN
// ═══════════════════════════════════════════════════════════════════════════

interface Session {
  // Identity
  id: SessionId;                    // 6-char alphanumeric, e.g., "a1b2c3"
  rev: number;                      // Monotonic session revision. Increments on any authoritative state change.
  join_secret_hash: string;         // hashed; join requires secret (unlisted)
  presenter_key_hash: string;       // hashed; required for presenter-only actions
  // Link format (recommended):
  // - Join link:      /s/<session_id>#join=<high_entropy_secret>
  // - Presenter link: /s/<session_id>#join=<...>&presenter=<presenter_key>
  created_at: Timestamp;            // Unix millis
  
  // Lifecycle
  state: SessionState;              // 'active' | 'presenter_disconnected' | 'expired'
  expires_at: Timestamp;            // created_at + 4 hours
  presenter_disconnect_at?: Timestamp;  // Set when presenter disconnects
  
  // Participants
  presenter: Participant;
  followers: Map<ParticipantId, Participant>;  // Max 20
  
  // Content
  slide: SlideInfo;
  overlays: Map<OverlayId, OverlayState>;       // up to 2
  overlay_order: OverlayId[];                   // z-order, top-most last
  layer_visibility: LayerVisibility;
  
  // Presenter state
  presenter_viewport: Viewport;
}

type SessionId = string;  // /^[a-z0-9]{6}$/
type SessionState = 'active' | 'presenter_disconnected' | 'expired';

interface Participant {
  id: ParticipantId;                // UUID v4
  name: string;                     // Auto-generated, e.g., "Blue Falcon"
  color: HexColor;                  // Assigned from palette, e.g., "#3B82F6"
  role: 'presenter' | 'follower';
  connected_at: Timestamp;
  last_seen_at: Timestamp;          // Updated on any message
  cursor?: CursorState;             // Null if not in viewport
  viewport?: Viewport;              // Follower's independent viewport
}

type ParticipantId = string;  // UUID v4
type HexColor = string;       // /^#[0-9A-Fa-f]{6}$/

interface CursorState {
  x: number;                        // Slide coordinates
  y: number;                        // Slide coordinates
  timestamp: Timestamp;             // For interpolation
}

interface Viewport {
  center_x: number;                 // Slide coordinates
  center_y: number;                 // Slide coordinates
  zoom: number;                     // OpenSeadragon zoom level
  timestamp: Timestamp;
}
```

### 2.2 Slide Schema

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// SLIDE DOMAIN
// ═══════════════════════════════════════════════════════════════════════════

interface SlideInfo {
  id: SlideId;                      // Unique identifier in WSIStreamer
  name: string;                     // Display name, e.g., "TCGA-AB-1234"
  
  // Dimensions
  width: number;                    // Full resolution width in pixels
  height: number;                   // Full resolution height in pixels
  tile_size: number;                // Typically 256 or 512
  num_levels: number;               // Pyramid levels
  
  // Metadata
  mpp?: number;                     // Microns per pixel (if available)
  vendor?: string;                  // Scanner vendor
  
  // Access
  tile_url_template: string;        // e.g., "http://wsi:3000/slide/{id}/tile/{level}/{x}/{y}"
}

type SlideId = string;
```

### 2.3 Overlay Schema

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY DOMAIN
// ═══════════════════════════════════════════════════════════════════════════

interface OverlayState {
  id: OverlayId;                    // UUID v4
  uploaded_by: ParticipantId;
  uploaded_at: Timestamp;
  
  // Source file info
  filename: string;
  file_size_bytes: number;
  content_sha256: string;           // content-addressed cache key

  // Parsed content summary
  cell_count: number;
  tile_count: number;
  
  // Class mappings (from protobuf)
  tissue_classes: Map<number, TissueClass>;  // class_id -> class info
  cell_classes: Map<number, CellClass>;      // class_id -> class info
}

type OverlayId = string;  // UUID v4

interface TissueClass {
  id: number;                       // 0-7 for 8 tissue classes
  name: string;                     // e.g., "Tumor", "Stroma", "Necrosis"
  color: HexColor;                  // Assigned color for heatmap
}

interface CellClass {
  id: number;                       // 0-14 for 15 cell classes
  name: string;                     // e.g., "Cancer cell", "Lymphocyte", "Macrophage"
  color: HexColor;                  // Assigned color for polygon fill
}

// Layer visibility (controlled by presenter, synced to all)
interface LayerVisibility {
  tissue_heatmap_visible: boolean;
  tissue_heatmap_opacity: number;   // 0.0 - 1.0
  tissue_classes_visible: Set<number>;  // Which tissue class IDs are visible
  
  cell_polygons_visible: boolean;
  cell_polygons_opacity: number;    // 0.0 - 1.0
  cell_classes_visible: Set<number>;    // Which cell class IDs are visible
  
  cell_hover_enabled: boolean;      // Show class on hover
}
```

### 2.4 Wire Protocol Schema

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET PROTOCOL
// ═══════════════════════════════════════════════════════════════════════════

// All messages are JSON except overlay_data which is MessagePack binary
// Realtime robustness: client->server messages carry seq; server can drop/coalesce under load.

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT → SERVER
// ─────────────────────────────────────────────────────────────────────────────

type ClientMessage =
  | { type: 'join_session'; session_id: SessionId; join_secret: string; last_seen_rev?: number; seq: number }
  | { type: 'create_session'; slide_id: SlideId; seq: number }
  | { type: 'presenter_auth'; presenter_key: string; seq: number }
  | { type: 'cursor_update'; x: number; y: number; seq: number }
  | { type: 'viewport_update'; center_x: number; center_y: number; zoom: number; seq: number }
  | { type: 'request_vector_detail'; request_id: number; viewport: Viewport; level: number; seq: number }
  | { type: 'layer_update'; visibility: LayerVisibility; seq: number }
  | { type: 'laser_pointer'; x: number; y: number; ttl_ms: number; seq: number }
  | { type: 'add_callout'; x: number; y: number; label?: string; seq: number }
  | { type: 'snap_to_presenter'; seq: number }
  | { type: 'ping'; seq: number };

// Server rejects presenter-only actions unless presenter_auth succeeded for that connection.

// ─────────────────────────────────────────────────────────────────────────────
// SERVER → CLIENT
// ─────────────────────────────────────────────────────────────────────────────

type ServerMessage =
  // Session lifecycle
  | { type: 'session_created'; session: SessionSnapshot }
  | { type: 'session_joined'; session: SessionSnapshot; you: Participant }
  | { type: 'state_patch'; base_rev: number; next_rev: number; patch: SessionPatch }
  | { type: 'resync_required'; server_rev: number }  // client should request full snapshot
  | { type: 'session_error'; code: ErrorCode; message: string }
  | { type: 'session_ended'; reason: 'expired' | 'presenter_left' }
  
  // Participant events
  | { type: 'participant_joined'; participant: Participant }
  | { type: 'participant_left'; participant_id: ParticipantId }
  | { type: 'presenter_reconnected' }
  
  // Presence updates (high frequency)
  | { type: 'presence_delta'; changed: CursorWithParticipant[]; removed: ParticipantId[]; server_ts: Timestamp }
  | { type: 'presenter_viewport'; viewport: Viewport }
  | { type: 'laser_pointer'; participant_id: ParticipantId; x: number; y: number; expires_at: Timestamp }
  | { type: 'callouts_state'; callouts: Callout[] }
  
  // Overlay events
  | { type: 'overlay_upload_progress'; percent: number }
  | { type: 'overlay_loaded'; overlay: OverlayState; overlay_order: OverlayId[] }
  | { type: 'overlay_data'; tiles: OverlayTileBatch }  // MessagePack binary
  | { type: 'overlay_removed'; overlay_id: OverlayId }
  
  // Layer state
  | { type: 'layer_state'; visibility: LayerVisibility }
  
  // Misc
  | { type: 'pong' };

interface CursorWithParticipant {
  participant_id: ParticipantId;
  name: string;
  color: HexColor;
  is_presenter: boolean;
  x: number;
  y: number;
}

interface SessionPatch {
  // Minimal patch format: only fields that changed (server-defined)
  layer_visibility?: LayerVisibility;
  overlay?: OverlayState | null;
  presenter_viewport?: Viewport;
  callouts_state?: Callout[];
}

interface SessionSnapshot {
  id: SessionId;
  rev: number;
  slide: SlideInfo;
  presenter: Participant;
  followers: Participant[];
  overlays: OverlayState[];
  overlay_order: OverlayId[];
  layer_visibility: LayerVisibility;
  presenter_viewport: Viewport;
}

type ErrorCode =
  | 'session_not_found'
  | 'session_full'
  | 'session_expired'
  | 'invalid_slide'
  | 'upload_failed'
  | 'invalid_protobuf';
```

### 2.5 Overlay Data Binary Format

For streaming cell polygons and tissue tiles efficiently:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// BINARY OVERLAY DATA (MessagePack encoded)
// ═══════════════════════════════════════════════════════════════════════════

interface OverlayTileBatch {
  request_id: number;               // Correlates with request
  level: number;                    // Pyramid level
  tiles: OverlayTile[];
}

interface OverlayTile {
  // Position
  tile_x: number;                   // Tile column
  tile_y: number;                   // Tile row
  
  // Tissue heatmap (224x224 uint8 array, class IDs)
  tissue_data?: Uint8Array;         // Null if no tissue data for this tile
  
  // Cell polygons in this tile
  cells: CellPolygon[];
}

interface CellPolygon {
  class_id: number;                 // 0-14
  confidence: number;               // 0.0-1.0, quantized to uint8 (0-255)
  centroid_x: number;               // Relative to tile origin
  centroid_y: number;               // Relative to tile origin
  vertices: Int16Array;             // Flattened [x0, y0, x1, y1, ...] relative to centroid
}
```

### 2.6 Validation Rules

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION RULES
// ═══════════════════════════════════════════════════════════════════════════

const ValidationRules = {
  // Session
  SESSION_ID_PATTERN: /^[a-z0-9]{6}$/,
  MAX_FOLLOWERS: 20,
  SESSION_MAX_DURATION_MS: 4 * 60 * 60 * 1000,  // 4 hours
  PRESENTER_GRACE_PERIOD_MS: 30 * 1000,         // 30 seconds
  
  // Participant
  PARTICIPANT_NAME_MAX_LENGTH: 32,
  CURSOR_UPDATE_MAX_RATE_HZ: 60,                // Client should send at 30Hz
  VIEWPORT_UPDATE_MAX_RATE_HZ: 20,              // Client should send at 10Hz
  
  // Overlay
  OVERLAY_MAX_SIZE_BYTES: 500 * 1024 * 1024,    // 500MB hard limit
  OVERLAY_UPLOAD_TIMEOUT_MS: 5 * 60 * 1000,     // 5 minutes
  OVERLAY_MAX_FILES_PER_SESSION: 2,             // small overlay stack (comparisons)
  OVERLAY_MAX_PARSE_SECONDS: 60,                // abort expensive parses
  OVERLAY_MAX_CELLS: 5_000_000,                 // sanity bounds
  OVERLAY_MAX_TILES: 500_000,                   // sanity bounds
  CELL_CLASS_ID_RANGE: [0, 14],                 // 15 classes
  TISSUE_CLASS_ID_RANGE: [0, 7],                // 8 classes
  // Render-time raster tiles should match slide tile size (256/512) to avoid resampling.
  // Underlying model artifacts may be 224; server resamples into render tiles.
  TILE_SIZE: 256,
  
  // Layer visibility
  OPACITY_RANGE: [0.0, 1.0],
  
  // Coordinates
  ZOOM_RANGE: [0.001, 100],                     // OpenSeadragon zoom levels
};

// Server-side validation functions
function validateSessionId(id: string): boolean {
  return ValidationRules.SESSION_ID_PATTERN.test(id);
}

function validateCursorUpdate(msg: CursorUpdate, slide: SlideInfo): boolean {
  return (
    Number.isFinite(msg.x) &&
    Number.isFinite(msg.y) &&
    msg.x >= 0 && msg.x <= slide.width &&
    msg.y >= 0 && msg.y <= slide.height
  );
}

function validateViewport(viewport: Viewport, slide: SlideInfo): boolean {
  return (
    Number.isFinite(viewport.center_x) &&
    Number.isFinite(viewport.center_y) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom >= ValidationRules.ZOOM_RANGE[0] &&
    viewport.zoom <= ValidationRules.ZOOM_RANGE[1]
  );
}

function validateLayerVisibility(vis: LayerVisibility): boolean {
  return (
    typeof vis.tissue_heatmap_visible === 'boolean' &&
    vis.tissue_heatmap_opacity >= 0 && vis.tissue_heatmap_opacity <= 1 &&
    typeof vis.cell_polygons_visible === 'boolean' &&
    vis.cell_polygons_opacity >= 0 && vis.cell_polygons_opacity <= 1 &&
    [...vis.tissue_classes_visible].every(id => 
      id >= ValidationRules.TISSUE_CLASS_ID_RANGE[0] && 
      id <= ValidationRules.TISSUE_CLASS_ID_RANGE[1]
    ) &&
    [...vis.cell_classes_visible].every(id =>
      id >= ValidationRules.CELL_CLASS_ID_RANGE[0] &&
      id <= ValidationRules.CELL_CLASS_ID_RANGE[1]
    )
  );
}

// Authorization rule: only presenter-authenticated connections can upload overlays
// or broadcast layer_update. Followers remain read-only for global state.
```

---

## 3. Component Specifications

### 3.1 Frontend Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           REACT APPLICATION                                      │
│                                                                                  │
│  src/                                                                           │
│  ├── main.tsx                      # Entry point                                │
│  ├── App.tsx                       # Router + providers                         │
│  │                                                                              │
│  ├── pages/                                                                     │
│  │   ├── Home.tsx                  # Landing page with demo slide              │
│  │   └── Session.tsx               # Main viewer page                          │
│  │                                                                              │
│  ├── components/                                                                │
│  │   ├── viewer/                                                               │
│  │   │   ├── SlideViewer.tsx       # OpenSeadragon wrapper                     │
│  │   │   ├── OverlayCanvas.tsx     # WebGL2 overlay layer                      │
│  │   │   ├── Minimap.tsx           # Overview with viewport indicators         │
│  │   │   └── CursorLayer.tsx       # SVG cursor overlays                       │
│  │   │                                                                          │
│  │   ├── sidebar/                                                              │
│  │   │   ├── LayerPanel.tsx        # Photoshop-style layer controls            │
│  │   │   ├── TissueClassList.tsx   # Tissue class toggles                      │
│  │   │   └── CellClassList.tsx     # Cell class toggles                        │
│  │   │                                                                          │
│  │   ├── session/                                                              │
│  │   │   ├── ShareButton.tsx       # Copy link to clipboard                    │
│  │   │   ├── ParticipantCount.tsx  # "3 viewers" badge                        │
│  │   │   └── SnapToPresenter.tsx   # "Follow presenter" button                │
│  │   │                                                                          │
│  │   └── upload/                                                               │
│  │       └── OverlayUploader.tsx   # Drag-drop + progress bar                  │
│  │                                                                              │
│  ├── hooks/                                                                     │
│  │   ├── useSession.ts             # WebSocket connection + state              │
│  │   ├── usePresence.ts            # Cursor + viewport sync                    │
│  │   ├── useOverlay.ts             # Overlay data management                   │
│  │   └── useLayerVisibility.ts     # Layer state management                    │
│  │                                                                              │
│  ├── webgl/                                                                     │
│  │   ├── PolygonRenderer.ts        # Instanced cell polygon rendering          │
│  │   ├── HeatmapRenderer.ts        # Tissue heatmap rendering                  │
│  │   ├── overlayWorker.ts          # MessagePack decode + buffer prep (Worker) │
│  │   ├── shaders/                                                              │
│  │   │   ├── polygon.vert.glsl                                                 │
│  │   │   ├── polygon.frag.glsl                                                 │
│  │   │   ├── heatmap.vert.glsl                                                 │
│  │   │   └── heatmap.frag.glsl                                                 │
│  │   └── SpatialIndex.ts           # Client-side viewport culling              │
│  │                                                                              │
│  ├── lib/                                                                       │
│  │   ├── websocket.ts              # WebSocket client with reconnection        │
│  │   ├── messagepack.ts            # Binary message encoding                   │
│  │   └── colors.ts                 # Participant color palette                 │
│  │                                                                              │
│  └── types/                                                                     │
│      └── index.ts                  # TypeScript interfaces                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Backend Architecture (Rust)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           RUST SERVER                                            │
│                                                                                  │
│  src/                                                                           │
│  ├── main.rs                       # Entry point, CLI args                      │
│  ├── config.rs                     # Configuration from env vars                │
│  │                                                                              │
│  ├── server/                                                                    │
│  │   ├── mod.rs                                                                │
│  │   ├── http.rs                   # Axum HTTP server (upload endpoint)        │
│  │   └── websocket.rs              # WebSocket upgrade + connection handling   │
│  │                                                                              │
│  ├── session/                                                                   │
│  │   ├── mod.rs                                                                │
│  │   ├── manager.rs                # Session CRUD + lifecycle                  │
│  │   ├── state.rs                  # Session state machine                     │
│  │   └── broadcast.rs              # Message fan-out to participants           │
│  │                                                                              │
│  ├── presence/                                                                  │
│  │   ├── mod.rs                                                                │
│  │   ├── cursor.rs                 # Cursor aggregation + broadcast            │
│  │   └── viewport.rs               # Viewport sync logic                       │
│  │                                                                              │
│  ├── overlay/                                                                   │
│  │   ├── mod.rs                                                                │
│  │   ├── parser.rs                 # Protobuf parsing (prost)                  │
│  │   ├── derive.rs                 # Build raster pyramid + vector chunks       │
│  │   ├── upload.rs                 # Resumable chunk upload + checksum          │
│  │   ├── index.rs                  # Tile-bin index (fast path) + optional R-tree│
│  │   └── streamer.rs               # Viewport-based tile streaming             │
│  │                                                                              │
│  ├── protocol/                                                                  │
│  │   ├── mod.rs                                                                │
│  │   ├── messages.rs               # Message type definitions                  │
│  │   ├── validation.rs             # Input validation                          │
│  │   └── codec.rs                  # JSON + MessagePack encoding               │
│  │                                                                              │
│  └── util/                                                                      │
│      ├── id.rs                     # Session ID generation                     │
│      ├── names.rs                  # Random name generation                    │
│      └── colors.rs                 # Color palette assignment                  │
│                                                                                  │
│  Cargo.toml dependencies:                                                       │
│  ├── tokio (async runtime)                                                     │
│  ├── axum (HTTP/WebSocket)                                                     │
│  ├── tokio-tungstenite (WebSocket)                                             │
│  ├── prost (protobuf)                                                          │
│  ├── rstar (R-tree)                                                            │
│  ├── rmp-serde (MessagePack)                                                   │
│  ├── serde + serde_json                                                        │
│  ├── dashmap (concurrent hashmap)                                              │
│  └── tracing (logging)                                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 WebGL2 Polygon Renderer

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// WEBGL2 INSTANCED POLYGON RENDERER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rendering strategy (explicit LOD + budgets):
 * - Low zoom: raster overlay tiles (tissue + optional density)
 * - Medium zoom: instanced centroids/points (very fast)
 * - High zoom: polygons, with a hard visible-instance budget + fallback
 *
 * Target: "smooth interaction" on typical laptops, not worst-case polygon counts.
 *
 * Renders polygons using:
 * 1. Instanced rendering (one draw call per cell class) using fixed-K resampled polygons
 * 2. Viewport frustum culling (only upload visible cells)
 * 3. Level-of-detail (simplify polygons at low zoom)
 * 4. GPU-based class filtering (discard in fragment shader)
 *
 * NOTE: Raw cell polygons have variable vertex counts. To make instancing practical:
 * - Server preprocesses to fixed-K vertices per cell at selected zoom levels (e.g., K=16/32)
 * - At very low zoom: render centroids / density only (or rely on raster overlay tiles)
 */
class PolygonRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  
  // Buffers
  private vertexBuffer: WebGLBuffer;      // Polygon vertices (shared geometry)
  private instanceBuffer: WebGLBuffer;    // Per-cell: position, class, confidence
  
  // Uniforms
  private uViewMatrix: WebGLUniformLocation;
  private uProjectionMatrix: WebGLUniformLocation;
  private uClassColors: WebGLUniformLocation;     // vec4[15] class colors
  private uClassVisibility: WebGLUniformLocation; // float[15] visibility flags
  private uOpacity: WebGLUniformLocation;
  
  // State
  private visibleCells: CellPolygon[] = [];
  private instanceData: Float32Array;
  private maxInstances: number = 120_000;  // Hard per-frame budget (tunable)
  
  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2')!;
    this.initShaders();
    this.initBuffers();
  }
  
  /**
   * Update visible cells based on current viewport.
   * Called when viewport changes or new overlay data arrives.
   */
  updateVisibleCells(cells: CellPolygon[], viewport: Viewport): void {
    // Frustum cull on CPU
    this.visibleCells = cells.filter(cell => 
      this.isInViewport(cell.centroid_x, cell.centroid_y, viewport)
    );
    
    // Upload instance data in batches
    this.uploadInstanceData();
  }
  
  /**
   * Render all visible cells.
   * Called every frame by animation loop.
   */
  render(viewMatrix: mat4, projectionMatrix: mat4, layerState: LayerVisibility): void {
    const gl = this.gl;
    
    if (!layerState.cell_polygons_visible || this.visibleCells.length === 0) {
      return;
    }
    
    gl.useProgram(this.program);
    
    // Set uniforms
    gl.uniformMatrix4fv(this.uViewMatrix, false, viewMatrix);
    gl.uniformMatrix4fv(this.uProjectionMatrix, false, projectionMatrix);
    gl.uniform1f(this.uOpacity, layerState.cell_polygons_opacity);
    
    // Set class colors and visibility
    this.updateClassUniforms(layerState);
    
    // Draw instanced (budgeted)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // Fan uses fixed-K vertices per instance (post-resample)
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, this.kVertices, instanceCount);
  }
  
  // ... shader initialization, buffer management, etc.
}
```

### 3.4 Presence System

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CLIENT-SIDE PRESENCE HOOK
// ═══════════════════════════════════════════════════════════════════════════

function usePresence(sessionId: string, isPresenter: boolean) {
  const [cursors, setCursors] = useState<CursorWithParticipant[]>([]);
  const [presenterViewport, setPresenterViewport] = useState<Viewport | null>(null);
  const { sendMessage, lastMessage } = useWebSocket();
  
  // Send cursor updates: event-driven + throttled (avoid sending when cursor is stationary)
  useEffect(() => {
    if (!sessionId) return;

    const sendThrottled = throttle((cursor) => {
      sendMessage({ type: 'cursor_update', x: cursor.x, y: cursor.y });
    }, 33);

    const onMove = () => {
      const cursor = getCurrentCursor();
      if (cursor) sendThrottled(cursor);
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    return () => window.removeEventListener('pointermove', onMove);
  }, [sessionId, sendMessage]);
  
  // Send viewport updates at 10Hz (presenter only)
  useEffect(() => {
    if (!sessionId || !isPresenter) return;
    
    const interval = setInterval(() => {
      const viewport = getCurrentViewport();  // From OpenSeadragon
      sendMessage({
        type: 'viewport_update',
        center_x: viewport.center_x,
        center_y: viewport.center_y,
        zoom: viewport.zoom,
      });
    }, 100);  // 10Hz
    
    return () => clearInterval(interval);
  }, [sessionId, isPresenter, sendMessage]);
  
  // Handle incoming presence updates
  useEffect(() => {
    if (!lastMessage) return;
    
    if (lastMessage.type === 'presence_delta') {
      // merge deltas locally; use server_ts for interpolation
      setCursors(prev => applyPresenceDelta(prev, lastMessage));
    } else if (lastMessage.type === 'presenter_viewport') {
      setPresenterViewport(lastMessage.viewport);
    }
  }, [lastMessage]);
  
  // Snap to presenter with smooth animation
  const snapToPresenter = useCallback(() => {
    if (!presenterViewport) return;
    
    animateViewport(presenterViewport, 300);  // 300ms animation
  }, [presenterViewport]);
  
  return { cursors, presenterViewport, snapToPresenter };
}
```

---

## 4. Implementation Roadmap

### Phase Overview

| Phase | Duration | Focus | Deliverable | ROI |
|-------|----------|-------|-------------|-----|
| **Phase 1** | 2 weeks | Core viewing | Single-user slide viewer with tile rendering | Foundation; unblocks all subsequent work |
| **Phase 2** | 2 weeks | Collaboration MVP | Multi-user sessions with cursor presence | Demo-able product; validates architecture |
| **Phase 3** | 2 weeks | Overlay rendering | WebGL2 cell polygons + tissue heatmaps | Core differentiator; enables real workflows |
| **Phase 4** | 1 week | Polish & Deploy | Docker packaging, demo slide, landing page | Shippable product |

**Total: 7 weeks to MVP**

---

### Phase 1: Core Viewing (Weeks 1-2)

**Objective:** Single-user slide viewer that renders tiles from WSIStreamer.

```
Week 1: Foundation
├── Day 1-2: Project setup
│   ├── React + Vite + TypeScript scaffolding
│   ├── Rust server skeleton (Axum)
│   ├── Docker Compose with WSIStreamer
│   └── CI/CD pipeline (GitHub Actions)
│
├── Day 3-4: Tile rendering
│   ├── OpenSeadragon integration
│   ├── Custom tile source for WSIStreamer
│   ├── Basic pan/zoom controls
│   └── Tile loading indicators
│
└── Day 5: Minimap
    ├── Navigator overlay
    ├── Click-to-jump
    └── Current viewport indicator

Week 2: Server Foundation
├── Day 1-2: Rust WebSocket server
│   ├── Connection handling
│   ├── Message parsing (JSON)
│   └── Basic ping/pong keepalive
│
├── Day 3-4: Session management
│   ├── Session creation (ID generation)
│   ├── Session joining
│   ├── Participant tracking
│   └── Session expiry (4h timer)
│
└── Day 5: Integration
    ├── Frontend WebSocket hook
    ├── Session creation flow
    └── URL routing (/s/:id)
```

**Phase 1 Deliverable:**
- User can open `localhost:5173`, see a slide, pan/zoom
- User can create a session and get a shareable URL
- Session persists for 4 hours

**Validation Criteria:**
- [ ] Tiles load within 200ms at any zoom level
- [ ] Minimap updates in real-time during pan
- [ ] Session URL can be opened in new tab (no collaboration yet, just same slide)

---

### Phase 2: Collaboration MVP (Weeks 3-4)

**Objective:** Multi-user sessions with real-time cursor presence and viewport awareness.

```
Week 3: Presence System
├── Day 1-2: Cursor tracking
│   ├── Mouse position → slide coordinates
│   ├── 30Hz client-side sampling
│   ├── Server aggregation + broadcast
│   └── Cursor rendering (colored dots + names)
│
├── Day 3-4: Viewport sync
│   ├── Presenter viewport broadcast (10Hz)
│   ├── Follower viewport indicator on minimap
│   ├── Rectangular overlay showing presenter's view
│   └── "Snap to presenter" button
│
└── Day 5: Smooth transitions
    ├── Viewport animation (300ms ease-out)
    ├── Cursor interpolation
    └── Participant join/leave notifications

Add (Week 3): Overlay vertical slice (de-risk)
├── Upload .pb (presenter-only)
├── Parse minimal metadata + build one overlay tile (raster)
└── Display overlay tile in viewer (no vector yet)

Week 4: Robustness
├── Day 1-2: Reconnection handling
│   ├── Client reconnect with exponential backoff
│   ├── Session state recovery on reconnect
│   ├── Presenter grace period (30s)
│   └── Session end handling
│
├── Day 3-4: Participant management
│   ├── Auto-generated names (adjective + animal)
│   ├── Color assignment (12-color palette)
│   ├── Max participants enforcement (20)
│   └── Presenter role assignment (first user)
│
└── Day 5: Polish
    ├── Participant count badge
    ├── Share button (copy to clipboard)
    └── Connection status indicator

Week 4 (add): Observability + Load test
├── Prometheus metrics endpoint + dashboards (latency, memory, WS queue)
└── Load test: 20 followers * N sessions, validate fan-out + backpressure behavior
```

**Phase 2 Deliverable:**
- Presenter creates session, shares link
- Followers join, see presenter's cursor + viewport bounds
- "Snap to presenter" animates smoothly
- Graceful handling of disconnects

**Validation Criteria:**
- [ ] Cursor latency < 100ms (measure round-trip)
- [ ] 20 concurrent followers with no degradation
- [ ] Reconnection works within grace period
- [ ] Viewport animation is smooth (no jank)

---

### Phase 3: Overlay Rendering (Weeks 5-6)

**Objective:** WebGL2 rendering of cell polygons and tissue heatmaps from uploaded protobuf files.

```
Week 5: Overlay Backend
├── Day 1-2: Protobuf parsing
│   ├── prost code generation from schema
│   ├── Streaming parser for large files
│   ├── Extract cells + tissue tiles
│   └── Class mapping extraction
│
├── Day 3-4: Spatial indexing
│   ├── R-tree construction (rstar crate)
│   ├── Viewport query API
│   ├── Tile-based retrieval
│   └── MessagePack serialization
│
└── Day 5: Upload flow
    ├── Chunked upload endpoint
    ├── Progress tracking
    ├── Broadcast overlay_loaded to session
    └── Memory management (session-scoped)

Week 6: WebGL2 Frontend
├── Day 1-2: Polygon renderer
│   ├── Instanced rendering setup
│   ├── Vertex/fragment shaders
│   ├── Class-based coloring
│   └── Opacity/visibility uniforms
│
├── Day 3-4: Heatmap renderer
│   ├── Texture-based tile rendering
│   ├── Color lookup table
│   ├── Alpha blending with slide tiles
│   └── Level-of-detail management
│
└── Day 5: Layer controls
    ├── Sidebar panel (collapsible)
    ├── Tissue class toggles
    ├── Cell class toggles
    ├── Opacity sliders
    └── Hover tooltip for cell class
```

**Phase 3 Deliverable:**
- Upload `.pb` file, overlay appears for all participants
- Layer visibility synced from presenter to followers
- Cell hover shows class name
- Smooth rendering at 1M+ polygons

**Validation Criteria:**
- [ ] 300MB file uploads in < 60 seconds
- [ ] 60fps with 1M visible polygons
- [ ] Layer toggle latency < 100ms
- [ ] Hover tooltip appears within 50ms

---

### Phase 4: Polish & Deploy (Week 7)

**Objective:** Production-ready deployment with demo content and landing page.

```
Week 7: Ship It
├── Day 1-2: Docker packaging
│   ├── Multi-stage Rust build
│   ├── Frontend static build
│   ├── docker-compose.yml
│   │   ├── pathcollab-server
│   │   ├── pathcollab-frontend (nginx)
│   │   └── wsistreamer
│   ├── Environment variable configuration
│   └── Health checks
│
├── Day 3-4: Demo content
│   ├── TCGA slide selection + upload
│   ├── Pre-generated overlay file
│   ├── Landing page with "Try Demo" button
│   └── Quick start documentation
│
└── Day 5: Launch prep
    ├── README.md with self-hosting guide
    ├── Deploy to VPS (public instance)
    ├── Basic monitoring (uptime, errors)
    └── Feedback collection mechanism
```

**Phase 4 Deliverable:**
- `docker-compose up` starts everything
- Public demo at pathcollab.io
- Self-hosting documentation

**Validation Criteria:**
- [ ] Cold start < 30 seconds
- [ ] Demo slide loads instantly
- [ ] Works on Chrome, Firefox, Safari
- [ ] Documentation covers 90% of setup questions

---

### Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebGL2 performance issues at 1M+ polygons | Medium | High | Week 5: Early profiling; fallback to Canvas2D for < 100K |
| Large file upload failures | Medium | Medium | Chunked upload with resume; client-side validation |
| WebSocket scalability at 50 sessions | Low | Medium | Week 4: Load test; horizontal scaling plan |
| Browser compatibility (Safari WebGL) | Medium | Low | Week 7: Polyfill/fallback; document requirements |
| Protobuf schema evolution | Low | Low | Version field in overlay state; backward compat |

---

### Configuration Parameters

```yaml
# config.example.yml
# PathCollab Server Configuration

server:
  host: "0.0.0.0"
  port: 8080
  public_base_url: "https://pathcollab.io"  # used for link generation (optional)
  behind_proxy: true                         # trust X-Forwarded-* (optional)

session:
  max_duration_hours: 4
  presenter_grace_period_seconds: 30
  max_followers: 20
  max_concurrent_sessions: 50
  # Optional (production): shared session registry for multi-instance / rolling restarts
  redis_url: ""  # e.g. redis://redis:6379

overlay:
  max_upload_size_mb: 500
  upload_timeout_seconds: 300
  cache_dir: "/var/lib/pathcollab/overlays"
  cache_max_gb: 50

presence:
  cursor_broadcast_hz: 30
  viewport_broadcast_hz: 10

wsistreamer:
  url: "http://wsistreamer:3000"
  
# Demo slide (auto-loaded on server start)
demo:
  enabled: true
  slide_id: "tcga-brca-001"
  overlay_path: "/data/demo/tcga-brca-001.pb"
```

---

## Appendix A: Color Palettes

### Participant Colors (12 colors, visually distinct)

```typescript
const PARTICIPANT_COLORS = [
  '#3B82F6',  // Blue
  '#EF4444',  // Red
  '#10B981',  // Emerald
  '#F59E0B',  // Amber
  '#8B5CF6',  // Violet
  '#EC4899',  // Pink
  '#06B6D4',  // Cyan
  '#F97316',  // Orange
  '#6366F1',  // Indigo
  '#14B8A6',  // Teal
  '#A855F7',  // Purple
  '#84CC16',  // Lime
];
```

### Tissue Class Colors (8 classes)

```typescript
const TISSUE_COLORS: Record<string, string> = {
  'Tumor':        '#EF4444',  // Red
  'Stroma':       '#F59E0B',  // Amber
  'Necrosis':     '#6B7280',  // Gray
  'Lymphocytes':  '#3B82F6',  // Blue
  'Mucus':        '#A855F7',  // Purple
  'Smooth Muscle':'#EC4899',  // Pink
  'Adipose':      '#FBBF24',  // Yellow
  'Background':   '#E5E7EB',  // Light gray
};
```

### Cell Class Colors (15 classes)

```typescript
const CELL_COLORS: Record<string, string> = {
  'Cancer cell':       '#DC2626',
  'Lymphocyte':        '#2563EB',
  'Macrophage':        '#7C3AED',
  'Neutrophil':        '#0891B2',
  'Plasma cell':       '#4F46E5',
  'Fibroblast':        '#D97706',
  'Endothelial':       '#059669',
  'Epithelial':        '#DB2777',
  'Myofibroblast':     '#EA580C',
  'Dendritic':         '#8B5CF6',
  'Mast cell':         '#0D9488',
  'Mitotic':           '#E11D48',
  'Apoptotic':         '#6B7280',
  'Giant cell':        '#7C2D12',
  'Unknown':           '#9CA3AF',
};
```

---

## Appendix B: Random Name Generator

```typescript
const ADJECTIVES = [
  'Swift', 'Bright', 'Calm', 'Deft', 'Eager', 'Fair', 'Gentle', 'Happy',
  'Keen', 'Lively', 'Merry', 'Noble', 'Polite', 'Quick', 'Serene', 'Tidy',
  'Vivid', 'Warm', 'Zesty', 'Bold',
];

const ANIMALS = [
  'Falcon', 'Otter', 'Panda', 'Robin', 'Tiger', 'Whale', 'Zebra', 'Koala',
  'Eagle', 'Dolphin', 'Fox', 'Owl', 'Wolf', 'Bear', 'Hawk', 'Seal',
  'Crane', 'Deer', 'Lynx', 'Swan',
];

function generateParticipantName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}
```

---

## Appendix C: Session ID Generation

```rust
use rand::Rng;

const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const SESSION_ID_LENGTH: usize = 6;

pub fn generate_session_id() -> String {
    let mut rng = rand::thread_rng();
    (0..SESSION_ID_LENGTH)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}
```

