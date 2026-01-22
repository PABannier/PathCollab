//! Unified Benchmark Suite for PathCollab
//!
//! This module provides a three-tier benchmark system for validating
//! server performance under load.
//!
//! ## Features
//!
//! - **Warm-up phase**: Primes caches and connection pools before measuring
//! - **Multiple iterations**: Runs 3 times for statistical significance
//! - **Baseline comparison**: Compares against stored baseline, detects regressions
//!
//! ## Benchmark Tiers
//!
//! | Tier       | Purpose           | Duration | Config                    |
//! |------------|-------------------|----------|---------------------------|
//! | `smoke`    | CI on every push  | <30s     | 5 sessions, 10 users, 10s |
//! | `standard` | PR merge gate     | ~2min    | 25 sessions, 50 users, 30s|
//! | `stress`   | Manual/release    | ~5min    | 100 sessions, 200 users   |
//!
//! ## Running Benchmarks
//!
//! ```bash
//! # Quick smoke test (CI) - 3 iterations with warm-up
//! cargo test --test perf_tests bench_smoke --release -- --ignored --nocapture
//!
//! # Standard test (PR merge gate)
//! cargo test --test perf_tests bench_standard --release -- --ignored --nocapture
//!
//! # Full stress test (manual/release)
//! cargo test --test perf_tests bench_stress --release -- --ignored --nocapture
//!
//! # Save current results as baseline
//! SAVE_BASELINE=1 cargo test --test perf_tests bench_smoke --release -- --ignored --nocapture
//! ```
//!
//! ## Baseline Management
//!
//! Baselines are stored in `.benchmark-baseline.json`. Set `SAVE_BASELINE=1` to update.

#![allow(clippy::collapsible_if)]

mod load_tests;

use load_tests::BenchmarkTier;
use load_tests::benchmark::{BenchmarkRunConfig, BenchmarkRunner};

/// Run a benchmark for the given tier with warm-up, iterations, and comparison
async fn run_benchmark(tier: BenchmarkTier) {
    let config = BenchmarkRunConfig::for_tier(tier);
    let runner = BenchmarkRunner::new(config.clone());

    let result = runner.run().await.expect("Benchmark should complete");

    // Print JSON for CI parsing
    println!("JSON: {}", result.to_json());

    // Save baseline if requested
    if std::env::var("SAVE_BASELINE").is_ok() {
        runner
            .save_baseline(&result.report)
            .expect("Failed to save baseline");
    }

    // Assert no regressions and budgets met
    assert!(
        result.all_passed,
        "Performance budgets not met for {} tier",
        tier.name()
    );
    assert!(
        !result.has_regression,
        "Performance regression detected for {} tier",
        tier.name()
    );
}

/// Smoke benchmark: Quick CI validation on every push
///
/// - Duration: ~30 seconds (2s warm-up + 3 × 10s iterations)
/// - Config: 5 sessions, 10 users
/// - Purpose: Fast feedback on obvious regressions
#[tokio::test]
#[ignore = "requires running server"]
async fn bench_smoke() {
    run_benchmark(BenchmarkTier::Smoke).await;
}

/// Standard benchmark: PR merge gate
///
/// - Duration: ~2 minutes (5s warm-up + 3 × 30s iterations)
/// - Config: 25 sessions, 50 users
/// - Purpose: Validate performance before merging PRs
#[tokio::test]
#[ignore = "requires running server"]
async fn bench_standard() {
    run_benchmark(BenchmarkTier::Standard).await;
}

/// Stress benchmark: Manual/release testing
///
/// - Duration: ~4 minutes (5s warm-up + 3 × 60s iterations)
/// - Config: 100 sessions, 200 users
/// - Purpose: Full stress test for releases
#[tokio::test]
#[ignore = "requires running server - long running"]
async fn bench_stress() {
    run_benchmark(BenchmarkTier::Stress).await;
}
