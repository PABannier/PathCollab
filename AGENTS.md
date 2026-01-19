# PathCollab - Agent Instructions

## Project Vision

PathCollab is a **collaborative digital pathology viewer** enabling real-time presenter-led sessions where pathologists can share whole slide images (WSIs) with synchronized navigation, annotations, and cursor tracking.

### Core Principles

1. **Performance is a feature** - Sub-100ms tile serving, real-time cursor sync
2. **Stripe-level UX** - Every interaction should feel instant and delightful
3. **Correctness under load** - 1000s of concurrent connections without degradation

---

## Running the Project

### Frontend (React + Vite)
```bash
cd ./web && bun run dev --port 3000
```

### Backend (Rust + Axum)
```bash
SLIDES_DIR=/data/wsi_slides \
PORT=8080 \
RUST_LOG=pathcollab=debug,tower_http=debug \
cargo run --release  # Always use --release for perf work
```

---

## Performance Requirements

### Hard Budgets (Non-Negotiable)

| Operation | P50 | P99 | Notes |
|-----------|-----|-----|-------|
| Tile serving | < 30ms | < 100ms | Including decode + resize + encode |
| Cursor broadcast | < 20ms | < 100ms | End-to-end WebSocket delivery |
| Viewport sync | < 50ms | < 150ms | Presenter → all viewers |
| Initial slide load | < 500ms | < 1s | Metadata + first tiles |

### Scaling Targets

- **Concurrent connections**: 1000+ per session
- **Tile throughput**: 10,000 tiles/sec at P99 < 100ms
- **Memory per connection**: < 50KB baseline

---

## Backend Guidelines (Rust)

### Code Style

```rust
// ✅ DO: Use zero-copy patterns
fn process_tile(data: &[u8]) -> Result<Bytes, TileError> {
    // Work with references, return owned only at boundaries
}

// ❌ DON'T: Unnecessary allocations in hot paths
fn process_tile(data: Vec<u8>) -> Result<Vec<u8>, TileError> {
    // Copies on every call
}
```

### Async Patterns

```rust
// ✅ DO: Spawn blocking work correctly
let tile = tokio::task::spawn_blocking(move || {
    decode_tile(&path, region)  // CPU-bound work
}).await??;

// ✅ DO: Use buffered channels for backpressure
let (tx, rx) = tokio::sync::mpsc::channel(32);

// ❌ DON'T: Block the async runtime
let tile = decode_tile(&path, region);  // Blocks executor!

// ❌ DON'T: Unbounded channels in production
let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
```

### Error Handling

```rust
// ✅ DO: Typed errors with context
#[derive(Debug, thiserror::Error)]
pub enum TileError {
    #[error("slide not found: {slide_id}")]
    SlideNotFound { slide_id: String },

    #[error("region out of bounds: {region:?} exceeds {dimensions:?}")]
    RegionOutOfBounds { region: Region, dimensions: Dimensions },

    #[error("decode failed: {source}")]
    DecodeFailed { #[from] source: image::ImageError },
}

// ✅ DO: Propagate with context
tile_cache.get(&key)
    .ok_or_else(|| TileError::SlideNotFound { slide_id: key.slide_id.clone() })?;
```

### Concurrency Patterns

```rust
// ✅ DO: Use DashMap for concurrent state
use dashmap::DashMap;
let sessions: DashMap<SessionId, Session> = DashMap::new();

// ✅ DO: Scope locks narrowly
{
    let session = sessions.get(&id).ok_or(Error::NotFound)?;
    session.connection_count()  // Lock released here
}

// ❌ DON'T: Hold locks across await points
let session = sessions.get(&id)?;
some_async_operation().await;  // Deadlock risk!
session.do_something();
```

### Performance Instrumentation

Always instrument new endpoints and hot paths:

```rust
use metrics::{histogram, counter};

async fn serve_tile(/* ... */) -> Result<Response, Error> {
    let start = std::time::Instant::now();

    let result = do_work().await;

    histogram!("pathcollab_tile_duration_seconds").record(start.elapsed());
    counter!("pathcollab_tiles_served_total").increment(1);

    result
}
```

### Caching Strategy

```rust
// Tile cache: LRU with size-based eviction
// Key insight: decoded tiles are larger than encoded, cache encoded

// ✅ DO: Cache at the right layer
cache_encoded_jpeg(&tile_key, &jpeg_bytes);  // ~50KB per tile

// ❌ DON'T: Cache decoded pixels
cache_decoded(&tile_key, &rgba_pixels);  // ~1MB per tile at 512x512
```

---

## Frontend Guidelines (React)

### Design Philosophy: Stripe-Level UX

1. **Instant feedback** - Every click has immediate visual response
2. **Optimistic updates** - Update UI before server confirms
3. **Graceful degradation** - Never show broken states
4. **Microinteractions** - Subtle animations that feel polished

### Component Patterns

```tsx
// ✅ DO: Optimistic UI with rollback
function useViewportSync() {
  const [viewport, setViewport] = useState(initialViewport);
  const [pending, setPending] = useState<Viewport | null>(null);

  const updateViewport = useCallback((newViewport: Viewport) => {
    // Immediate local update
    setViewport(newViewport);
    setPending(newViewport);

    // Send to server
    ws.send({ type: 'viewport', data: newViewport });
  }, [ws]);

  // Handle server rejection (rare)
  useEffect(() => {
    ws.on('viewport_rejected', (serverViewport) => {
      setViewport(serverViewport);  // Rollback
      toast.error('Viewport sync failed');
    });
  }, [ws]);

  return { viewport, updateViewport, isSyncing: pending !== null };
}
```

### Loading States

```tsx
// ✅ DO: Skeleton loaders that match content shape
function TileGrid({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }
  // ... actual content
}

// ❌ DON'T: Generic spinners for everything
if (loading) return <Spinner />;
```

### Error Boundaries

```tsx
// ✅ DO: Granular error boundaries
<ErrorBoundary fallback={<SlideErrorState onRetry={refetch} />}>
  <SlideViewer slideId={slideId} />
</ErrorBoundary>

// Keep the rest of the UI functional when one component fails
```

### Animation Guidelines

```tsx
// ✅ DO: Use CSS transforms for performance
const cursorStyle = {
  transform: `translate(${x}px, ${y}px)`,
  transition: 'transform 16ms linear',  // Match 60fps
};

// ❌ DON'T: Animate layout properties
const cursorStyle = {
  left: x,  // Triggers layout recalc
  top: y,   // Every frame
};
```

### State Management

```tsx
// Prefer React Query for server state
const { data: slide, isLoading, error } = useQuery({
  queryKey: ['slide', slideId],
  queryFn: () => fetchSlide(slideId),
  staleTime: 5 * 60 * 1000,  // 5 min - slide metadata rarely changes
});

// Use Zustand for client state that needs to be fast
const useViewerStore = create((set) => ({
  zoom: 1,
  center: { x: 0, y: 0 },
  setZoom: (zoom) => set({ zoom }),
  // ...
}));
```

### WebSocket Integration

```tsx
// ✅ DO: Reconnection with exponential backoff
function useWebSocket(url: string) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const retriesRef = useRef(0);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setStatus('connected');
        retriesRef.current = 0;
      };

      ws.onclose = () => {
        setStatus('disconnected');
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
        retriesRef.current++;
        setTimeout(connect, delay);
      };

      return ws;
    };

    const ws = connect();
    return () => ws.close();
  }, [url]);

  return { status };
}
```

---

## Testing Requirements

### Before Every PR

```bash
# 1. Type check
cd web && bun run typecheck
cargo check --all-targets

# 2. Lint
cd web && bun run lint
cargo clippy -- -D warnings

# 3. Unit tests
cd web && bun test
cargo test

# 4. Quick perf check (if touching hot paths)
./bench/load_tests/scenarios/tile_stress.sh --quick
```

### Performance Testing

```bash
# Quick performance check
SLIDES_DIR=/data/wsi_slides DEMO_ENABLED=true cargo run --release
./bench/load_tests/scenarios/tile_stress.sh --quick
python3 ./bench/scripts/compare_baseline.py \
  --current bench/load_tests/results/tile_current.json \
  --baseline bench/baselines/tile_baseline.json

# Full benchmark suite (before major changes)
./bench/scripts/run_all.sh --compare-baseline

# Save new baseline after confirmed improvements
./bench/scripts/run_all.sh --save-baseline
```

### Live Metrics

```bash
# JSON format
curl http://localhost:8080/metrics

# Prometheus format (with histograms)
curl http://localhost:8080/metrics/prometheus
```

Key metrics:
- `pathcollab_tile_duration_seconds` - Total tile serving latency
- `pathcollab_tile_phase_duration_seconds{phase="read|resize|encode"}` - Per-phase breakdown
- `pathcollab_ws_broadcast_duration_seconds` - WebSocket broadcast latency

---

## Common Pitfalls

### Rust

| Pitfall | Solution |
|---------|----------|
| Blocking async runtime | Use `spawn_blocking` for CPU work, `block_in_place` sparingly |
| Unbounded memory growth | Always use bounded channels and LRU caches |
| Lock contention | Prefer `DashMap`, scope locks narrowly, never hold across `.await` |
| Slow JSON serialization | Use `serde_json::to_writer` with pre-allocated buffers |

### React

| Pitfall | Solution |
|---------|----------|
| Render thrashing from WS | Batch updates with `requestAnimationFrame` or `useDeferredValue` |
| Stale closures in effects | Use refs for values that change frequently |
| Layout thrashing | Animate only `transform` and `opacity` |
| Memory leaks | Clean up WS listeners and intervals in effect cleanup |
