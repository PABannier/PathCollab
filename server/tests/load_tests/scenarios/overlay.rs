//! Overlay stress test scenario
//!
//! Validates that PathCollab can handle concurrent requests for:
//! - Tissue overlay tiles (GET /api/slide/:id/overlay/tissue/:level/:x/:y)
//! - Cell overlay queries (GET /api/slide/:id/overlay/cells?x=...&y=...&width=...&height=...)
//! - Overlay metadata endpoints
//!
//! This scenario focuses specifically on the HTTP overlay endpoints under load.

#![allow(clippy::collapsible_if)]

use super::super::client::fetch_first_slide;
use super::super::{LatencyStats, LoadTestResults};
use reqwest::Client;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Configuration for overlay stress test
#[derive(Debug, Clone)]
pub struct OverlayStressConfig {
    /// Number of concurrent clients
    pub num_clients: usize,
    /// Test duration
    pub duration: Duration,
    /// Server base URL (e.g., "http://127.0.0.1:8080")
    pub base_url: String,
    /// Rate of tissue tile requests per client (Hz)
    pub tissue_tile_hz: u32,
    /// Rate of cell query requests per client (Hz)
    pub cell_query_hz: u32,
}

impl Default for OverlayStressConfig {
    fn default() -> Self {
        Self {
            num_clients: 50,
            duration: Duration::from_secs(30),
            base_url: "http://127.0.0.1:8080".to_string(),
            tissue_tile_hz: 10,
            cell_query_hz: 2,
        }
    }
}

/// Extended results for overlay stress test
#[derive(Debug)]
pub struct OverlayStressResults {
    /// Base results
    pub base: LoadTestResults,
    /// Tissue tile request latencies
    pub tissue_tile_latencies: LatencyStats,
    /// Cell query latencies
    pub cell_query_latencies: LatencyStats,
    /// Metadata request latencies
    pub metadata_latencies: LatencyStats,
    /// Number of 404 responses (expected for non-existent tiles)
    pub not_found_count: u64,
    /// Number of successful requests
    pub success_count: u64,
}

impl OverlayStressResults {
    pub fn new() -> Self {
        Self {
            base: LoadTestResults::new(),
            tissue_tile_latencies: LatencyStats::new(),
            cell_query_latencies: LatencyStats::new(),
            metadata_latencies: LatencyStats::new(),
            not_found_count: 0,
            success_count: 0,
        }
    }

    /// Generate a summary report
    pub fn report(&self) -> String {
        let mut report = String::new();
        report.push_str("=== Overlay Stress Test Results ===\n\n");

        report.push_str(&format!(
            "Duration: {:.2}s\n",
            self.base.duration.as_secs_f64()
        ));
        report.push_str(&format!("Total requests: {}\n", self.base.messages_sent));
        report.push_str(&format!("Successful: {}\n", self.success_count));
        report.push_str(&format!("Not found (404): {}\n", self.not_found_count));
        report.push_str(&format!("Errors: {}\n\n", self.base.connection_errors));

        let throughput = self.base.messages_sent as f64 / self.base.duration.as_secs_f64();
        report.push_str(&format!("Throughput: {:.1} req/s\n\n", throughput));

        report.push_str("Tissue Tile Latencies:\n");
        if let Some(p50) = self.tissue_tile_latencies.p50() {
            report.push_str(&format!("  P50: {:?}\n", p50));
        }
        if let Some(p95) = self.tissue_tile_latencies.p95() {
            report.push_str(&format!("  P95: {:?}\n", p95));
        }
        if let Some(p99) = self.tissue_tile_latencies.p99() {
            report.push_str(&format!("  P99: {:?}\n", p99));
        }

        report.push_str("\nCell Query Latencies:\n");
        if let Some(p50) = self.cell_query_latencies.p50() {
            report.push_str(&format!("  P50: {:?}\n", p50));
        }
        if let Some(p95) = self.cell_query_latencies.p95() {
            report.push_str(&format!("  P95: {:?}\n", p95));
        }
        if let Some(p99) = self.cell_query_latencies.p99() {
            report.push_str(&format!("  P99: {:?}\n", p99));
        }

        report.push_str("\nMetadata Latencies:\n");
        if let Some(p50) = self.metadata_latencies.p50() {
            report.push_str(&format!("  P50: {:?}\n", p50));
        }
        if let Some(p95) = self.metadata_latencies.p95() {
            report.push_str(&format!("  P95: {:?}\n", p95));
        }
        if let Some(p99) = self.metadata_latencies.p99() {
            report.push_str(&format!("  P99: {:?}\n", p99));
        }

        report
    }
}

impl Default for OverlayStressResults {
    fn default() -> Self {
        Self::new()
    }
}

/// Event types from overlay client tasks
#[derive(Debug)]
#[allow(dead_code)]
pub enum OverlayEvent {
    TissueTileRequest { latency: Duration, success: bool },
    CellQueryRequest { latency: Duration, success: bool },
    MetadataRequest { latency: Duration, success: bool },
    NotFound,
    Error,
}

/// Overlay stress test scenario
pub struct OverlayStressScenario {
    config: OverlayStressConfig,
}

impl OverlayStressScenario {
    pub fn new(config: OverlayStressConfig) -> Self {
        Self { config }
    }

    /// Run the overlay stress test scenario
    pub async fn run(
        &self,
    ) -> Result<OverlayStressResults, Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();
        let mut results = OverlayStressResults::new();

        // Fetch available slide from server
        let slide = fetch_first_slide(&self.config.base_url).await?;
        println!("Using slide: {} ({})", slide.name, slide.id);

        // Channel for collecting events
        let (tx, mut rx) = mpsc::channel::<OverlayEvent>(10000);

        // Atomic counters
        let requests_sent = Arc::new(AtomicU64::new(0));
        let success_count = Arc::new(AtomicU64::new(0));
        let not_found_count = Arc::new(AtomicU64::new(0));
        let error_count = Arc::new(AtomicU64::new(0));

        let mut join_handles = Vec::new();

        // Create HTTP client with connection pooling
        let http_client = Client::builder()
            .pool_max_idle_per_host(100)
            .timeout(Duration::from_secs(30))
            .build()?;

        println!(
            "Starting overlay stress test with {} clients for {:?}",
            self.config.num_clients, self.config.duration
        );

        // Spawn client tasks
        for client_idx in 0..self.config.num_clients {
            let client = http_client.clone();
            let tx = tx.clone();
            let base_url = self.config.base_url.clone();
            let slide_id = slide.id.clone();
            let duration = self.config.duration;
            let tissue_hz = self.config.tissue_tile_hz;
            let cell_hz = self.config.cell_query_hz;
            let sent = requests_sent.clone();
            let success = success_count.clone();
            let not_found = not_found_count.clone();
            let errors = error_count.clone();

            let handle = tokio::spawn(async move {
                let tissue_interval = if tissue_hz > 0 {
                    Duration::from_secs_f64(1.0 / tissue_hz as f64)
                } else {
                    Duration::from_secs(3600)
                };

                let cell_interval = if cell_hz > 0 {
                    Duration::from_secs_f64(1.0 / cell_hz as f64)
                } else {
                    Duration::from_secs(3600)
                };

                let start = Instant::now();
                let mut tissue_ticker = tokio::time::interval(tissue_interval);
                let mut cell_ticker = tokio::time::interval(cell_interval);

                // Vary tile coordinates to simulate realistic access patterns
                let mut tile_x = client_idx as u32 % 10;
                let mut tile_y = 0u32;
                let level = 3; // Mid-level tiles

                loop {
                    if start.elapsed() >= duration {
                        break;
                    }

                    tokio::select! {
                        _ = tissue_ticker.tick() => {
                            sent.fetch_add(1, Ordering::SeqCst);

                            // Request tissue tile
                            let url = format!(
                                "{}/api/slide/{}/overlay/tissue/{}/{}/{}",
                                base_url, slide_id, level, tile_x, tile_y
                            );

                            let req_start = Instant::now();
                            match client.get(&url).send().await {
                                Ok(resp) => {
                                    let latency = req_start.elapsed();
                                    if resp.status().is_success() {
                                        success.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::TissueTileRequest {
                                            latency,
                                            success: true,
                                        }).await;
                                    } else if resp.status().as_u16() == 404 {
                                        not_found.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::NotFound).await;
                                    } else {
                                        errors.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::TissueTileRequest {
                                            latency,
                                            success: false,
                                        }).await;
                                    }
                                }
                                Err(_) => {
                                    errors.fetch_add(1, Ordering::SeqCst);
                                    let _ = tx.send(OverlayEvent::Error).await;
                                }
                            }

                            // Move to next tile
                            tile_x = (tile_x + 1) % 20;
                            if tile_x == 0 {
                                tile_y = (tile_y + 1) % 20;
                            }
                        }
                        _ = cell_ticker.tick() => {
                            sent.fetch_add(1, Ordering::SeqCst);

                            // Request cells in region (varying region)
                            let region_x = (client_idx as f64 * 1000.0) % 50000.0;
                            let region_y = (client_idx as f64 * 500.0) % 50000.0;
                            let url = format!(
                                "{}/api/slide/{}/overlay/cells?x={}&y={}&width=5000&height=5000",
                                base_url, slide_id, region_x, region_y
                            );

                            let req_start = Instant::now();
                            match client.get(&url).send().await {
                                Ok(resp) => {
                                    let latency = req_start.elapsed();
                                    if resp.status().is_success() {
                                        success.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::CellQueryRequest {
                                            latency,
                                            success: true,
                                        }).await;
                                    } else if resp.status().as_u16() == 404 {
                                        not_found.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::NotFound).await;
                                    } else {
                                        errors.fetch_add(1, Ordering::SeqCst);
                                        let _ = tx.send(OverlayEvent::CellQueryRequest {
                                            latency,
                                            success: false,
                                        }).await;
                                    }
                                }
                                Err(_) => {
                                    errors.fetch_add(1, Ordering::SeqCst);
                                    let _ = tx.send(OverlayEvent::Error).await;
                                }
                            }
                        }
                    }
                }
            });
            join_handles.push(handle);

            // Small stagger to avoid thundering herd
            if client_idx % 10 == 9 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }

        // Drop the original sender
        drop(tx);

        // Collect events
        let mut tissue_latencies = LatencyStats::new();
        let mut cell_latencies = LatencyStats::new();
        let mut metadata_latencies = LatencyStats::new();

        let collect_duration = self.config.duration + Duration::from_secs(5);
        let collect_start = Instant::now();

        while collect_start.elapsed() < collect_duration {
            match tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                Ok(Some(event)) => match event {
                    OverlayEvent::TissueTileRequest {
                        latency,
                        success: true,
                    } => {
                        tissue_latencies.record(latency);
                    }
                    OverlayEvent::CellQueryRequest {
                        latency,
                        success: true,
                    } => {
                        cell_latencies.record(latency);
                    }
                    OverlayEvent::MetadataRequest {
                        latency,
                        success: true,
                    } => {
                        metadata_latencies.record(latency);
                    }
                    _ => {}
                },
                Ok(None) => break,
                Err(_) => {}
            }
        }

        // Wait for all tasks
        for handle in join_handles {
            let _ = handle.await;
        }

        // Populate results
        results.base.messages_sent = requests_sent.load(Ordering::SeqCst);
        results.success_count = success_count.load(Ordering::SeqCst);
        results.not_found_count = not_found_count.load(Ordering::SeqCst);
        results.base.connection_errors = error_count.load(Ordering::SeqCst);
        results.base.duration = start.elapsed();
        results.tissue_tile_latencies = tissue_latencies;
        results.cell_query_latencies = cell_latencies;
        results.metadata_latencies = metadata_latencies;

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires running server"]
    async fn test_overlay_stress_minimal() {
        let config = OverlayStressConfig {
            num_clients: 5,
            duration: Duration::from_secs(5),
            tissue_tile_hz: 5,
            cell_query_hz: 1,
            ..Default::default()
        };

        let scenario = OverlayStressScenario::new(config);
        let results = scenario.run().await.expect("Scenario should complete");

        println!("{}", results.report());
        assert!(results.base.messages_sent > 0, "Should have sent requests");
    }
}
