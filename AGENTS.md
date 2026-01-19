# Agent Instructions

## Running the frontend

```bash
cd ./web && bun run dev --port 3000
```

## Running the backend in development

To launch the backend, you'll need to specify the directory that contains the WSIs, and the directory that contains the overlays.

```bash
SLIDES_DIR=/data/wsi_slides OVERLAY_DIR=/data/cell_masks PORT=8080 RUST_LOG=pathcollab=debug,tower_http=debug cargo run
```

## Benchmarking and Performance Testing

### Quick Performance Check

To quickly assess the impact of changes on latency:

```bash
# 1. Start the server with real slides
SLIDES_DIR=/data/wsi_slides OVERLAY_CACHE_DIR=/tmp/overlay DEMO_ENABLED=true \
  cargo run --release

# 2. Run quick tile stress test (in another terminal)
./bench/load_tests/scenarios/tile_stress.sh --quick

# 3. Compare against baseline
python3 ./bench/scripts/compare_baseline.py \
  --current bench/load_tests/results/tile_current.json \
  --baseline bench/baselines/tile_baseline.json
```

### Full Benchmark Suite

For thorough performance assessment before merging significant changes:

```bash
# Run complete benchmark suite with baseline comparison
./bench/scripts/run_all.sh --compare-baseline

# Or save a new baseline after confirmed improvements
./bench/scripts/run_all.sh --save-baseline
```

This runs:
1. **HTTP tile stress test** - Measures tile serving latency (P50/P90/P95/P99)
2. **WebSocket load test** - Validates cursor/viewport broadcast latency
3. **Baseline comparison** - Fails if P99 regresses >10%

### Key Metrics to Monitor

| Metric | Budget | Source |
|--------|--------|--------|
| Tile serving P99 | < 100ms | `tile_stress.sh` |
| Cursor broadcast P99 | < 100ms | WebSocket load test |
| Viewport broadcast P99 | < 150ms | WebSocket load test |

### Live Metrics

The server exposes Prometheus metrics for real-time monitoring:

- `/metrics` - JSON format (sessions, connections, uptime)
- `/metrics/prometheus` - Prometheus format with histograms:
  - `pathcollab_tile_duration_seconds` - Total tile serving latency
  - `pathcollab_tile_phase_duration_seconds{phase="read|resize|encode"}` - Per-phase breakdown
  - `pathcollab_ws_broadcast_duration_seconds` - WebSocket broadcast latency
