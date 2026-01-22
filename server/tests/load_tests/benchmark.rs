//! Benchmark runner with warm-up, multiple iterations, and baseline comparison
//!
//! Provides a production-grade benchmark system that:
//! - Runs a warm-up phase to prime caches and connection pools
//! - Executes multiple iterations for statistical significance
//! - Compares against stored baseline and detects regressions

use super::BenchmarkTier;
use super::scenarios::{ComprehensiveStressConfig, ComprehensiveStressScenario};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;


/// Configuration for benchmark runs
#[derive(Debug, Clone)]
pub struct BenchmarkRunConfig {
    /// Benchmark tier
    pub tier: BenchmarkTier,
    /// Number of iterations to run (default: 3)
    pub iterations: usize,
    /// Warm-up duration before measuring (default: 3s for smoke, 5s for others)
    pub warmup_duration: Duration,
    /// Path to baseline file (default: .benchmark-baseline.json in project root)
    pub baseline_path: PathBuf,
    /// Regression threshold as percentage (default: 15%)
    pub regression_threshold_pct: f64,
}

impl BenchmarkRunConfig {
    pub fn for_tier(tier: BenchmarkTier) -> Self {
        let (iterations, warmup) = match tier {
            BenchmarkTier::Smoke => (3, Duration::from_secs(2)),
            BenchmarkTier::Standard => (3, Duration::from_secs(5)),
            BenchmarkTier::Stress => (3, Duration::from_secs(5)),
        };

        Self {
            tier,
            iterations,
            warmup_duration: warmup,
            baseline_path: PathBuf::from(".benchmark-baseline.json"),
            regression_threshold_pct: 15.0,
        }
    }
}

/// Metrics extracted from a single benchmark run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkMetrics {
    pub tile_p99_ms: Option<f64>,
    pub overlay_p99_ms: Option<f64>,
    pub cursor_p99_ms: Option<f64>,
    pub viewport_p99_ms: Option<f64>,
    pub error_rate: f64,
    pub throughput: f64,
}

impl BenchmarkMetrics {
    /// Extract metrics from comprehensive stress results
    pub fn from_results(
        results: &super::scenarios::comprehensive::ComprehensiveStressResults,
    ) -> Self {
        let throughput = if results.duration.as_secs_f64() > 0.0 {
            (results.ws_messages_sent + results.http_requests_sent) as f64
                / results.duration.as_secs_f64()
        } else {
            0.0
        };

        Self {
            tile_p99_ms: results
                .tile_latencies
                .p99()
                .map(|d| d.as_secs_f64() * 1000.0),
            overlay_p99_ms: results
                .overlay_latencies
                .p99()
                .map(|d| d.as_secs_f64() * 1000.0),
            cursor_p99_ms: results
                .cursor_latencies
                .p99()
                .map(|d| d.as_secs_f64() * 1000.0),
            viewport_p99_ms: results
                .viewport_latencies
                .p99()
                .map(|d| d.as_secs_f64() * 1000.0),
            error_rate: results.error_rate(),
            throughput,
        }
    }
}

/// Statistical summary of a metric across iterations
#[derive(Debug, Clone)]
pub struct MetricStats {
    pub mean: f64,
    pub stddev: f64,
}

impl MetricStats {
    pub fn from_samples(samples: &[f64]) -> Option<Self> {
        if samples.is_empty() {
            return None;
        }

        let n = samples.len() as f64;
        let mean = samples.iter().sum::<f64>() / n;

        let variance = if samples.len() > 1 {
            samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0)
        } else {
            0.0
        };
        let stddev = variance.sqrt();

        Some(Self { mean, stddev })
    }

    /// Format as "mean ± stddev"
    pub fn format(&self) -> String {
        if self.stddev < 0.1 {
            format!("{:.1}ms", self.mean)
        } else {
            format!("{:.1}ms ± {:.1}ms", self.mean, self.stddev)
        }
    }
}

/// Aggregated results from multiple benchmark iterations
#[derive(Debug)]
pub struct BenchmarkReport {
    pub tier: BenchmarkTier,
    pub iterations: usize,
    pub warmup_duration: Duration,
    pub tile_p99: Option<MetricStats>,
    pub overlay_p99: Option<MetricStats>,
    pub cursor_p99: Option<MetricStats>,
    pub viewport_p99: Option<MetricStats>,
    pub error_rate: MetricStats,
    pub throughput: MetricStats,
    pub all_passed: bool,
}

impl BenchmarkReport {
    /// Aggregate metrics from multiple runs
    pub fn from_metrics(
        tier: BenchmarkTier,
        warmup_duration: Duration,
        metrics: Vec<BenchmarkMetrics>,
        all_passed: bool,
    ) -> Self {
        let iterations = metrics.len();

        let tile_samples: Vec<f64> = metrics.iter().filter_map(|m| m.tile_p99_ms).collect();
        let overlay_samples: Vec<f64> = metrics.iter().filter_map(|m| m.overlay_p99_ms).collect();
        let cursor_samples: Vec<f64> = metrics.iter().filter_map(|m| m.cursor_p99_ms).collect();
        let viewport_samples: Vec<f64> = metrics.iter().filter_map(|m| m.viewport_p99_ms).collect();
        let error_samples: Vec<f64> = metrics.iter().map(|m| m.error_rate * 100.0).collect();
        let throughput_samples: Vec<f64> = metrics.iter().map(|m| m.throughput).collect();

        Self {
            tier,
            iterations,
            warmup_duration,
            tile_p99: MetricStats::from_samples(&tile_samples),
            overlay_p99: MetricStats::from_samples(&overlay_samples),
            cursor_p99: MetricStats::from_samples(&cursor_samples),
            viewport_p99: MetricStats::from_samples(&viewport_samples),
            error_rate: MetricStats::from_samples(&error_samples).unwrap(),
            throughput: MetricStats::from_samples(&throughput_samples).unwrap(),
            all_passed,
        }
    }

    /// Convert to baseline format for storage
    pub fn to_baseline(&self) -> Baseline {
        Baseline {
            tier: self.tier.name().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            tile_p99_ms: self.tile_p99.as_ref().map(|s| s.mean),
            overlay_p99_ms: self.overlay_p99.as_ref().map(|s| s.mean),
            cursor_p99_ms: self.cursor_p99.as_ref().map(|s| s.mean),
            viewport_p99_ms: self.viewport_p99.as_ref().map(|s| s.mean),
            error_rate_pct: self.error_rate.mean,
            throughput: self.throughput.mean,
        }
    }
}

/// Stored baseline for comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Baseline {
    pub tier: String,
    pub timestamp: String,
    pub tile_p99_ms: Option<f64>,
    pub overlay_p99_ms: Option<f64>,
    pub cursor_p99_ms: Option<f64>,
    pub viewport_p99_ms: Option<f64>,
    pub error_rate_pct: f64,
    pub throughput: f64,
}

impl Baseline {
    /// Load baseline from file
    pub fn load(path: &PathBuf, tier: &str) -> Option<Self> {
        let content = std::fs::read_to_string(path).ok()?;
        let baselines: std::collections::HashMap<String, Baseline> =
            serde_json::from_str(&content).ok()?;
        baselines.get(tier).cloned()
    }

    /// Save baseline to file (preserves other tiers)
    pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
        let mut baselines: std::collections::HashMap<String, Baseline> =
            std::fs::read_to_string(path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default();

        baselines.insert(self.tier.clone(), self.clone());

        let json = serde_json::to_string_pretty(&baselines)?;
        std::fs::write(path, json)
    }
}

/// Comparison result between current run and baseline
#[derive(Debug)]
pub struct Comparison {
    pub metric_name: &'static str,
    pub current: Option<f64>,
    pub baseline: Option<f64>,
    pub change_pct: Option<f64>,
    pub is_regression: bool,
    pub higher_is_worse: bool, // true for latency/error, false for throughput
}

impl Comparison {
    fn new(
        metric_name: &'static str,
        current: Option<f64>,
        baseline: Option<f64>,
        threshold_pct: f64,
        higher_is_worse: bool,
    ) -> Self {
        let change_pct = match (current, baseline) {
            (Some(c), Some(b)) if b > 0.0 => Some((c - b) / b * 100.0),
            _ => None,
        };

        let is_regression = change_pct
            .map(|pct| {
                if higher_is_worse {
                    pct > threshold_pct
                } else {
                    pct < -threshold_pct
                }
            })
            .unwrap_or(false);

        Self {
            metric_name,
            current,
            baseline,
            change_pct,
            is_regression,
            higher_is_worse,
        }
    }

    fn format_value(&self, value: Option<f64>) -> String {
        match value {
            Some(v) => {
                if self.metric_name.contains("P99") {
                    format!("{:.1}ms", v)
                } else if self.metric_name == "Error Rate" {
                    format!("{:.2}%", v)
                } else {
                    format!("{:.1}", v)
                }
            }
            None => "N/A".to_string(),
        }
    }

    fn format_change(&self) -> String {
        match self.change_pct {
            Some(pct) => {
                let sign = if pct >= 0.0 { "+" } else { "" };
                let status = if self.is_regression {
                    "[REGRESSION]"
                } else if pct.abs() < 5.0 {
                    "[OK]"
                } else if (self.higher_is_worse && pct < 0.0)
                    || (!self.higher_is_worse && pct > 0.0)
                {
                    "[IMPROVED]"
                } else {
                    "[WARNING]"
                };
                format!("({}{:.1}%) {}", sign, pct, status)
            }
            None => "".to_string(),
        }
    }
}

/// Benchmark runner that handles warm-up, iterations, and comparison
pub struct BenchmarkRunner {
    config: BenchmarkRunConfig,
}

impl BenchmarkRunner {
    pub fn new(config: BenchmarkRunConfig) -> Self {
        Self { config }
    }

    /// Run the full benchmark with warm-up, iterations, and comparison
    pub async fn run(&self) -> Result<BenchmarkResult, Box<dyn std::error::Error + Send + Sync>> {
        let stress_config = ComprehensiveStressConfig::for_tier(self.config.tier);

        println!();
        println!("═══════════════════════════════════════════════════════════════");
        println!(
            " BENCHMARK: {} ({} iterations)",
            self.config.tier.name(),
            self.config.iterations
        );
        println!("═══════════════════════════════════════════════════════════════");

        // Run warm-up phase
        if self.config.warmup_duration > Duration::ZERO {
            println!();
            println!(
                " ─── Warm-up ({:.0}s) ───────────────────────────────────────────",
                self.config.warmup_duration.as_secs_f64()
            );

            let warmup_config = ComprehensiveStressConfig {
                duration: self.config.warmup_duration,
                ..stress_config.clone()
            };
            let warmup_scenario = ComprehensiveStressScenario::new(warmup_config);
            let _ = warmup_scenario.run().await?;
            println!("   Warm-up complete, starting measured iterations...");
        }

        // Run iterations
        let mut metrics = Vec::new();
        let mut all_passed = true;

        for i in 0..self.config.iterations {
            println!();
            println!(
                " ─── Iteration {}/{} ─────────────────────────────────────────────",
                i + 1,
                self.config.iterations
            );

            let scenario = ComprehensiveStressScenario::new(stress_config.clone());
            let results = scenario.run().await?;

            let passed = results.meets_budgets();
            if !passed {
                all_passed = false;
            }

            let m = BenchmarkMetrics::from_results(&results);
            println!(
                "   Tile P99: {:.1}ms | Error: {:.2}% | Throughput: {:.0} ops/s | {}",
                m.tile_p99_ms.unwrap_or(0.0),
                m.error_rate * 100.0,
                m.throughput,
                if passed { "PASS" } else { "FAIL" }
            );

            metrics.push(m);
        }

        // Generate report
        let report = BenchmarkReport::from_metrics(
            self.config.tier,
            self.config.warmup_duration,
            metrics,
            all_passed,
        );

        // Load baseline and compare
        let baseline = Baseline::load(&self.config.baseline_path, self.config.tier.name());
        let comparisons = self.compare(&report, &baseline);

        // Print comparison
        self.print_comparison(&report, &baseline, &comparisons);

        // Check for regressions
        let has_regression = comparisons.iter().any(|c| c.is_regression);

        Ok(BenchmarkResult {
            report,
            has_regression,
            all_passed,
        })
    }

    fn compare(&self, report: &BenchmarkReport, baseline: &Option<Baseline>) -> Vec<Comparison> {
        let threshold = self.config.regression_threshold_pct;
        let baseline = baseline.as_ref();

        vec![
            Comparison::new(
                "Tile P99",
                report.tile_p99.as_ref().map(|s| s.mean),
                baseline.and_then(|b| b.tile_p99_ms),
                threshold,
                true,
            ),
            Comparison::new(
                "Overlay P99",
                report.overlay_p99.as_ref().map(|s| s.mean),
                baseline.and_then(|b| b.overlay_p99_ms),
                threshold,
                true,
            ),
            Comparison::new(
                "Error Rate",
                Some(report.error_rate.mean),
                baseline.map(|b| b.error_rate_pct),
                threshold,
                true,
            ),
            Comparison::new(
                "Throughput",
                Some(report.throughput.mean),
                baseline.map(|b| b.throughput),
                threshold,
                false,
            ),
        ]
    }

    #[allow(clippy::print_literal)]
    fn print_comparison(
        &self,
        report: &BenchmarkReport,
        baseline: &Option<Baseline>,
        comparisons: &[Comparison],
    ) {
        println!();
        println!("═══════════════════════════════════════════════════════════════");
        println!(
            " RESULTS: {} ({} iterations, {:.0}s warm-up)",
            self.config.tier.name(),
            report.iterations,
            report.warmup_duration.as_secs_f64()
        );
        println!("═══════════════════════════════════════════════════════════════");
        println!();

        if baseline.is_some() {
            println!(" ─── Comparison vs Baseline ──────────────────────────────────");
            println!();
            println!(
                "   {:12} {:>14}   {:>14}   {}",
                "Metric", "Current", "Baseline", "Change"
            );
            println!(
                "   {:12} {:>14}   {:>14}   {}",
                "──────", "───────", "────────", "──────"
            );

            for c in comparisons {
                if c.current.is_some() || c.baseline.is_some() {
                    println!(
                        "   {:12} {:>14}   {:>14}   {}",
                        c.metric_name,
                        c.format_value(c.current),
                        c.format_value(c.baseline),
                        c.format_change()
                    );
                }
            }
        } else {
            println!(" ─── Results (no baseline) ───────────────────────────────────");
            println!();
            if let Some(ref stats) = report.tile_p99 {
                println!("   Tile P99:     {}", stats.format());
            }
            if let Some(ref stats) = report.overlay_p99 {
                println!("   Overlay P99:  {}", stats.format());
            }
            println!(
                "   Error Rate:   {:.2}% ± {:.2}%",
                report.error_rate.mean, report.error_rate.stddev
            );
            println!(
                "   Throughput:   {:.0} ± {:.0} ops/s",
                report.throughput.mean, report.throughput.stddev
            );
            println!();
            println!("   (Run again to establish baseline, or use --save-baseline)");
        }

        println!();
        println!("═══════════════════════════════════════════════════════════════");

        let has_regression = comparisons.iter().any(|c| c.is_regression);
        let overall = if !report.all_passed {
            "FAIL (budget exceeded)"
        } else if has_regression {
            "FAIL (regression detected)"
        } else {
            "PASS"
        };
        println!(" OVERALL: {}", overall);
        println!("═══════════════════════════════════════════════════════════════");
        println!();
    }

    /// Save current results as the new baseline
    pub fn save_baseline(&self, report: &BenchmarkReport) -> std::io::Result<()> {
        let baseline = report.to_baseline();
        baseline.save(&self.config.baseline_path)?;
        println!(
            "Baseline saved to {:?} for tier {}",
            self.config.baseline_path,
            self.config.tier.name()
        );
        Ok(())
    }
}

/// Full benchmark result
pub struct BenchmarkResult {
    pub report: BenchmarkReport,
    pub has_regression: bool,
    pub all_passed: bool,
}

impl BenchmarkResult {
    /// Returns true if benchmark passed (no budget violations and no regressions)
    pub fn passed(&self) -> bool {
        self.all_passed && !self.has_regression
    }

    /// Generate JSON output for CI
    pub fn to_json(&self) -> String {
        let tile_p99 = self.report.tile_p99.as_ref().map(|s| s.mean);
        let overlay_p99 = self.report.overlay_p99.as_ref().map(|s| s.mean);

        let tile_str = tile_p99
            .map(|v| format!("{:.2}", v))
            .unwrap_or_else(|| "null".to_string());
        let overlay_str = overlay_p99
            .map(|v| format!("{:.2}", v))
            .unwrap_or_else(|| "null".to_string());

        format!(
            r#"{{"passed":{},"tier":"{}","iterations":{},"warmup_secs":{:.0},"tile_p99_ms":{},"overlay_p99_ms":{},"error_rate_pct":{:.2},"throughput":{:.1},"has_regression":{}}}"#,
            self.passed(),
            self.report.tier.name(),
            self.report.iterations,
            self.report.warmup_duration.as_secs_f64(),
            tile_str,
            overlay_str,
            self.report.error_rate.mean,
            self.report.throughput.mean,
            self.has_regression
        )
    }
}
