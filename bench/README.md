# PathCollab Benchmark Suite

Comprehensive profiling and load testing infrastructure for the PathCollab collaborative slide viewer server.

## Quick Start

```bash
# Install dependencies
cargo install oha  # HTTP load testing tool

# Run quick benchmark (5 connections, 10 seconds)
./bench/load_tests/scenarios/tile_stress.sh --quick

# Run full benchmark suite
./bench/scripts/run_all.sh

# Run with baseline comparison (fails CI if P99 regresses >10%)
./bench/scripts/run_all.sh --compare-baseline
```

## Prerequisites

### Required

- **Rust toolchain** (stable, for building server and Criterion benchmarks)
- **Running PathCollab server** with slides available

### Optional (for full suite)

- **oha**: HTTP load testing tool
  ```bash
  cargo install oha
  ```
- **Python 3.6+**: For baseline comparison and report generation
- **jq**: For parsing JSON results in shell scripts

## Directory Structure

```
bench/
├── README.md                    # This file
├── load_tests/
│   ├── scenarios/
│   │   ├── tile_stress.sh       # HTTP tile endpoint stress test
│   │   ├── ramp_test.sh         # Gradual load increase to find breaking point
│   │   └── combined_load.sh     # HTTP + WebSocket simultaneous load
│   └── results/                 # Test output (.gitignored)
├── baselines/
│   ├── tile_baseline.json       # HTTP tile performance baseline
│   └── websocket_baseline.json  # WebSocket performance baseline
└── scripts/
    ├── run_all.sh               # Orchestrate full benchmark suite
    ├── compare_baseline.py      # Compare results to baseline
    └── generate_report.py       # Generate markdown report

server/benches/                  # Criterion micro-benchmarks
├── tile_encoding.rs             # JPEG encoding, image resize
├── spatial_index.rs             # R-tree query performance
└── message_serialization.rs     # JSON serialization for WebSocket
```

## Running Benchmarks

### 1. HTTP Tile Load Tests

Stress test the tile serving endpoint:

```bash
# Quick test (5 connections, 10 seconds)
./bench/load_tests/scenarios/tile_stress.sh --quick

# Standard test (10 connections, 30 seconds)
./bench/load_tests/scenarios/tile_stress.sh

# Custom configuration
./bench/load_tests/scenarios/tile_stress.sh \
    --url http://localhost:8080 \
    --concurrent 20 \
    --duration 60 \
    --output results/tile_test.json

# Find breaking point with ramp test
./bench/load_tests/scenarios/ramp_test.sh \
    --start 1 \
    --end 100 \
    --step 10
```

### 2. WebSocket Load Tests

Test session broadcasting under load:

```bash
cd server

# Quick test (1 session, 3 followers, 3 seconds)
cargo test --test perf_tests test_fanout_minimal --release -- --ignored --nocapture

# Standard test (5 sessions, 20 followers, 30 seconds)
cargo test --test perf_tests test_fanout_standard --release -- --ignored --nocapture

# Extended test (5 minutes)
cargo test --test perf_tests test_fanout_extended --release -- --ignored --nocapture
```

### 3. Combined Load Test

Simulate realistic production load with both HTTP and WebSocket traffic:

```bash
./bench/load_tests/scenarios/combined_load.sh \
    --tile-concurrent 10 \
    --ws-sessions 3 \
    --ws-followers 10 \
    --duration 30
```

### 4. Full Benchmark Suite

Run everything with a single command:

```bash
# Full suite with report generation
./bench/scripts/run_all.sh

# Quick mode
./bench/scripts/run_all.sh --quick

# Skip specific phases
./bench/scripts/run_all.sh --skip-micro --skip-websocket

# Compare to baseline
./bench/scripts/run_all.sh --compare-baseline

# Save new baseline
./bench/scripts/run_all.sh --save-baseline
```

## Performance Budgets

These are the target latencies for production use:

| Metric | Budget | Description |
|--------|--------|-------------|
| Tile P99 | < 100ms | HTTP tile serving latency |
| Cursor P99 | < 100ms | WebSocket cursor broadcast |
| Viewport P99 | < 150ms | WebSocket viewport broadcast |
| Message Handling | < 10ms | Server-side message processing |

## Baseline Management

### Creating a Baseline

```bash
# Run benchmarks and save as baseline
./bench/scripts/run_all.sh --save-baseline

# Or manually from results
./bench/scripts/compare_baseline.py \
    --save-baseline bench/load_tests/results/latest/tile_stress.json \
    --output bench/baselines/tile_baseline.json \
    --description "Baseline after performance optimization"
```

### Comparing to Baseline

```bash
# Compare and output to terminal
./bench/scripts/compare_baseline.py \
    --current bench/load_tests/results/latest/tile_stress.json \
    --baseline bench/baselines/tile_baseline.json

# Markdown output (for PR comments)
./bench/scripts/compare_baseline.py \
    --current results.json \
    --baseline baseline.json \
    --markdown

# CI mode (exit code 1 on regression)
./bench/scripts/compare_baseline.py \
    --current results.json \
    --baseline baseline.json \
    --threshold 10 \
    --ci
```

## CI Integration

### GitHub Actions

The existing `.github/workflows/perf.yml` can be extended:

```yaml
- name: Run benchmark suite
  run: |
    ./bench/scripts/run_all.sh \
      --quick \
      --compare-baseline \
      2>&1 | tee benchmark_output.txt

- name: Check for regressions
  run: |
    if grep -q "FAILED" benchmark_output.txt; then
      echo "Performance regression detected!"
      exit 1
    fi
```

### Exit Codes

All scripts follow Unix conventions:
- `0`: Success / no regressions
- `1`: Failure / regression detected
- `2`: Configuration or dependency error

## Interpreting Results

### HTTP Tile Benchmarks

```
Throughput:   450 req/s        # Higher is better
P50 latency:  8.5ms            # Median response time
P95 latency:  25.3ms           # 95th percentile
P99 latency:  48.2ms           # 99th percentile (main target)
Success rate: 100%             # Should be 100%
```

**What "good" looks like:**
- P99 < 100ms for tile serving
- Success rate > 99%
- Throughput scales linearly with concurrency up to CPU saturation

### WebSocket Benchmarks

```
Messages sent:     9000
Messages received: 180000       # ~20x sent (fan-out to followers)
Cursor P99:        45ms         # Broadcast latency
Viewport P99:      62ms         # Slightly larger messages
```

**What "good" looks like:**
- Cursor P99 < 100ms
- Viewport P99 < 150ms
- No message drops (received ≈ sent × followers)

### Micro-benchmarks

```
jpeg_encoding/256x256/85    time: [1.2345 ms 1.2456 ms 1.2567 ms]
```

- **Low/Mid/High**: Confidence interval for timing
- Compare to previous runs to detect regressions
- HTML reports in `target/criterion/` show trends over time

## Troubleshooting

### "oha not found"

```bash
cargo install oha
```

### "Server not responding"

Ensure the server is running:
```bash
cd server && cargo run --release
```

Or specify a different URL:
```bash
./bench/load_tests/scenarios/tile_stress.sh --url http://localhost:9090
```

### "No slides found"

The tile tests require at least one slide in the server's slides directory:
```bash
# Check configured slides directory in .env or environment
ls $SLIDES_DIR

# Or use demo mode
DEMO_ENABLED=true cargo run --release
```

### Benchmark results vary widely

- Ensure no other CPU-intensive processes are running
- Run multiple iterations and compare medians
- For Criterion benchmarks, the tool handles statistical analysis automatically
- For load tests, use longer durations for more stable results

### WebSocket tests timeout

Check that:
1. Server is compiled in release mode (`cargo build --release`)
2. No firewall blocking WebSocket connections
3. Sufficient file descriptors (`ulimit -n`)

## Adding New Benchmarks

### New Load Test Scenario

1. Create script in `bench/load_tests/scenarios/`
2. Follow the pattern of existing scripts (argument parsing, colors, etc.)
3. Output JSON for machine parsing
4. Add to `run_all.sh` if appropriate

## Server Metrics

The server exposes Prometheus metrics at `/metrics/prometheus`:

```bash
# Key metrics for benchmarking
curl -s http://localhost:8080/metrics/prometheus | grep pathcollab

# Tile serving
pathcollab_tile_requests_total
pathcollab_tile_duration_seconds
pathcollab_tile_phase_duration_seconds{phase="read|resize|encode"}

# WebSocket
pathcollab_ws_messages_total
pathcollab_ws_message_duration_seconds
pathcollab_ws_broadcast_duration_seconds
```

These can be scraped during load tests for detailed analysis.
