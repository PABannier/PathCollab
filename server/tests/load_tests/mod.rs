//! Load testing module for PathCollab
//!
//! This module provides load testing infrastructure to validate
//! that PathCollab can handle activity spikes with 20 followers
//! per session at 30Hz cursor + 10Hz viewport updates.
//!
//! ## Benchmark Tiers
//!
//! The benchmark system uses three tiers:
//! - **Smoke**: Quick CI validation on every push (<30s)
//! - **Standard**: PR merge gate (~2min)
//! - **Stress**: Manual/release testing (~5min)

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

/// Performance budget thresholds
pub mod budgets {
    use std::time::Duration;

    /// Maximum acceptable P99 cursor broadcast latency
    pub const CURSOR_P99_MAX: Duration = Duration::from_millis(100);

    /// Maximum acceptable P99 viewport broadcast latency
    pub const VIEWPORT_P99_MAX: Duration = Duration::from_millis(150);

    /// Maximum acceptable message handling time
    pub const MESSAGE_HANDLING_MAX: Duration = Duration::from_millis(10);
}

/// Load test configuration
#[derive(Debug, Clone)]
pub struct LoadTestConfig {
    /// Number of sessions to create
    pub num_sessions: usize,
    /// Number of followers per session
    pub followers_per_session: usize,
    /// Cursor update rate (Hz)
    pub cursor_hz: u32,
    /// Viewport update rate (Hz)
    pub viewport_hz: u32,
    /// Test duration
    pub duration: Duration,
    /// Server WebSocket URL
    pub ws_url: String,
    /// Server HTTP base URL (for fetching slide info)
    pub http_url: String,
}

impl Default for LoadTestConfig {
    fn default() -> Self {
        Self {
            num_sessions: 5,
            followers_per_session: 20,
            cursor_hz: 30,
            viewport_hz: 10,
            duration: Duration::from_secs(60),
            ws_url: "ws://127.0.0.1:8080/ws".to_string(),
            http_url: "http://127.0.0.1:8080".to_string(),
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
    pub fn percentile(&self, p: f64) -> Option<Duration> {
        if self.samples.is_empty() {
            return None;
        }

        let mut sorted = self.samples.clone();
        sorted.sort();

        let idx = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
        Some(sorted[idx.min(sorted.len() - 1)])
    }

    /// Calculate P50 (median)
    pub fn p50(&self) -> Option<Duration> {
        self.percentile(50.0)
    }

    /// Calculate P95
    pub fn p95(&self) -> Option<Duration> {
        self.percentile(95.0)
    }

    /// Calculate P99
    pub fn p99(&self) -> Option<Duration> {
        self.percentile(99.0)
    }
}

/// Load test results
#[derive(Debug)]
pub struct LoadTestResults {
    /// Cursor broadcast latencies
    pub cursor_latencies: LatencyStats,
    /// Viewport broadcast latencies
    pub viewport_latencies: LatencyStats,
    /// Message handling latencies
    pub message_latencies: LatencyStats,
    /// Total messages sent
    pub messages_sent: u64,
    /// Total messages received
    pub messages_received: u64,
    /// Connection errors
    pub connection_errors: u64,
    /// Test duration
    pub duration: Duration,
}

impl LoadTestResults {
    pub fn new() -> Self {
        Self {
            cursor_latencies: LatencyStats::new(),
            viewport_latencies: LatencyStats::new(),
            message_latencies: LatencyStats::new(),
            messages_sent: 0,
            messages_received: 0,
            connection_errors: 0,
            duration: Duration::ZERO,
        }
    }

    /// Check if results meet performance budgets
    pub fn meets_budgets(&self) -> bool {
        let cursor_ok = self
            .cursor_latencies
            .p99()
            .map(|p| p <= budgets::CURSOR_P99_MAX)
            .unwrap_or(true);

        let viewport_ok = self
            .viewport_latencies
            .p99()
            .map(|p| p <= budgets::VIEWPORT_P99_MAX)
            .unwrap_or(true);

        let message_ok = self
            .message_latencies
            .p99()
            .map(|p| p <= budgets::MESSAGE_HANDLING_MAX)
            .unwrap_or(true);

        cursor_ok && viewport_ok && message_ok
    }

    /// Generate a summary report
    pub fn report(&self) -> String {
        let mut report = String::new();
        report.push_str("=== Load Test Results ===\n\n");

        report.push_str(&format!("Duration: {:.2}s\n", self.duration.as_secs_f64()));
        report.push_str(&format!("Messages sent: {}\n", self.messages_sent));
        report.push_str(&format!("Messages received: {}\n", self.messages_received));
        report.push_str(&format!(
            "Connection errors: {}\n\n",
            self.connection_errors
        ));

        report.push_str("Cursor Latencies:\n");
        if let Some(p50) = self.cursor_latencies.p50() {
            report.push_str(&format!("  P50: {:?}\n", p50));
        }
        if let Some(p95) = self.cursor_latencies.p95() {
            report.push_str(&format!("  P95: {:?}\n", p95));
        }
        if let Some(p99) = self.cursor_latencies.p99() {
            report.push_str(&format!(
                "  P99: {:?} (budget: {:?}) {}\n",
                p99,
                budgets::CURSOR_P99_MAX,
                if p99 <= budgets::CURSOR_P99_MAX {
                    "OK"
                } else {
                    "EXCEEDED"
                }
            ));
        }

        report.push_str("\nViewport Latencies:\n");
        if let Some(p50) = self.viewport_latencies.p50() {
            report.push_str(&format!("  P50: {:?}\n", p50));
        }
        if let Some(p95) = self.viewport_latencies.p95() {
            report.push_str(&format!("  P95: {:?}\n", p95));
        }
        if let Some(p99) = self.viewport_latencies.p99() {
            report.push_str(&format!(
                "  P99: {:?} (budget: {:?}) {}\n",
                p99,
                budgets::VIEWPORT_P99_MAX,
                if p99 <= budgets::VIEWPORT_P99_MAX {
                    "OK"
                } else {
                    "EXCEEDED"
                }
            ));
        }

        report.push_str(&format!(
            "\nOverall: {}\n",
            if self.meets_budgets() { "PASS" } else { "FAIL" }
        ));

        report
    }
}

impl Default for LoadTestResults {
    fn default() -> Self {
        Self::new()
    }
}
