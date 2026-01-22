//! Unified Benchmark Suite for PathCollab
//!
//! This module provides a three-tier benchmark system for validating
//! server performance under load.
//!
//! ## Benchmark Tiers
//!
//! | Tier       | Purpose           | Duration | Config                    |
//! |------------|-------------------|----------|---------------------------|
//! | `smoke`    | CI on every push  | <30s     | 5 sessions, 10 users, 10s |
//! | `standard` | PR merge gate     | ~2min    | 25 sessions, 50 users, 30s|
//! | `stress`   | Manual/release    | ~5min    | 100 sessions, 200 users   |
//!
//! ## Hot Paths Tested
//!
//! 1. **Tile serving** - HTTP P99 latency (budget: <500ms)
//! 2. **WebSocket cursor broadcast** - P99 latency (budget: <100ms)
//! 3. **WebSocket viewport broadcast** - P99 latency (budget: <150ms)
//! 4. **Error rate** - Must be <1%
//!
//! ## Running Benchmarks
//!
//! ```bash
//! # Quick smoke test (CI)
//! cargo test --test perf_tests bench_smoke --release -- --ignored --nocapture
//!
//! # Standard test (PR merge gate)
//! cargo test --test perf_tests bench_standard --release -- --ignored --nocapture
//!
//! # Full stress test (manual/release)
//! cargo test --test perf_tests bench_stress --release -- --ignored --nocapture
//! ```

#![allow(clippy::collapsible_if)]

mod load_tests;

use load_tests::BenchmarkTier;
use load_tests::scenarios::{ComprehensiveStressConfig, ComprehensiveStressScenario};

/// Run a benchmark for the given tier and assert it passes
async fn run_benchmark(tier: BenchmarkTier) {
    let config = ComprehensiveStressConfig::for_tier(tier);

    println!("\nStarting {} benchmark...", tier.name());
    println!(
        "Config: {} sessions, {} users, {:?} duration",
        config.num_sessions,
        config.num_sessions * 2,
        config.duration
    );

    let scenario = ComprehensiveStressScenario::new(config);
    let results = scenario.run().await.expect("Scenario should complete");

    // Print formatted summary
    results.print_summary(tier);

    // Print JSON for CI parsing
    println!("JSON: {}", results.to_json());

    // Assert basic functionality
    assert!(
        results.ws_messages_sent > 0,
        "Should have sent WebSocket messages"
    );
    assert!(
        results.http_requests_sent > 0,
        "Should have sent HTTP requests"
    );

    // Assert performance budgets are met
    assert!(
        results.meets_budgets(),
        "Performance budgets not met for {} tier",
        tier.name()
    );
}

/// Smoke benchmark: Quick CI validation on every push
///
/// - Duration: ~10 seconds
/// - Config: 5 sessions, 10 users
/// - Purpose: Fast feedback on obvious regressions
#[tokio::test]
#[ignore = "requires running server"]
async fn bench_smoke() {
    run_benchmark(BenchmarkTier::Smoke).await;
}

/// Standard benchmark: PR merge gate
///
/// - Duration: ~30 seconds
/// - Config: 25 sessions, 50 users
/// - Purpose: Validate performance before merging PRs
#[tokio::test]
#[ignore = "requires running server"]
async fn bench_standard() {
    run_benchmark(BenchmarkTier::Standard).await;
}

/// Stress benchmark: Manual/release testing
///
/// - Duration: ~60 seconds
/// - Config: 100 sessions, 200 users
/// - Purpose: Full stress test for releases
#[tokio::test]
#[ignore = "requires running server - long running"]
async fn bench_stress() {
    run_benchmark(BenchmarkTier::Stress).await;
}
