//! Load testing module for PathCollab
//!
//! Provides a unified benchmark system with three tiers:
//! - **Smoke**: Quick CI validation on every push (<30s)
//! - **Standard**: PR merge gate (~2min)
//! - **Stress**: Manual/release testing (~5min)
//!
//! ## Running Benchmarks
//!
//! ```bash
//! # Smoke test (CI)
//! cargo test --test perf_tests bench_smoke --release -- --ignored --nocapture
//!
//! # Standard test (PR gate)
//! cargo test --test perf_tests bench_standard --release -- --ignored --nocapture
//!
//! # Stress test (release)
//! cargo test --test perf_tests bench_stress --release -- --ignored --nocapture
//! ```

#![allow(clippy::collapsible_if)]

pub mod client;
pub mod scenarios;

use std::time::Duration;

/// Benchmark tier for different testing scenarios
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BenchmarkTier {
    /// Quick CI validation: 5 sessions, 10 users, 10s
    Smoke,
    /// PR merge gate: 25 sessions, 50 users, 30s
    Standard,
    /// Manual/release testing: 100 sessions, 200 users, 60s
    Stress,
}

impl BenchmarkTier {
    /// Get the tier name for display
    pub fn name(&self) -> &'static str {
        match self {
            BenchmarkTier::Smoke => "SMOKE",
            BenchmarkTier::Standard => "STANDARD",
            BenchmarkTier::Stress => "STRESS",
        }
    }
}

/// Latency statistics collected during load test
#[derive(Debug, Default)]
pub struct LatencyStats {
    pub samples: Vec<Duration>,
}

impl LatencyStats {
    pub fn new() -> Self {
        Self {
            samples: Vec::new(),
        }
    }

    pub fn record(&mut self, latency: Duration) {
        self.samples.push(latency);
    }

    /// Calculate percentile (0-100)
    fn percentile(&self, p: f64) -> Option<Duration> {
        if self.samples.is_empty() {
            return None;
        }

        let mut sorted = self.samples.clone();
        sorted.sort();

        let idx = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
        Some(sorted[idx.min(sorted.len() - 1)])
    }

    /// Calculate P99
    pub fn p99(&self) -> Option<Duration> {
        self.percentile(99.0)
    }
}
