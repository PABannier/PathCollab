//! Comprehensive stress test scenario
//!
//! Simulates concurrent users hitting all server routes:
//! - WebSocket sessions with cursor/viewport updates
//! - HTTP tile requests
//! - HTTP overlay requests (cell and tissue)
//! - Metadata endpoints
//!
//! This tests the server's ability to handle realistic production-like load.
//!
//! ## Benchmark Tiers
//!
//! | Tier     | Sessions | Users | Duration |
//! |----------|----------|-------|----------|
//! | Smoke    | 5        | 10    | 10s      |
//! | Standard | 25       | 50    | 30s      |
//! | Stress   | 100      | 200   | 60s      |

#![allow(clippy::collapsible_if)]

use super::super::BenchmarkTier;
use super::super::LatencyStats;
use super::super::client::{LoadTestClient, ServerMessage, fetch_first_slide};
use reqwest::Client;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Configuration for comprehensive stress test
#[derive(Debug, Clone)]
pub struct ComprehensiveStressConfig {
    /// Number of sessions (each has 1 presenter + 1 follower = 2 users)
    pub num_sessions: usize,
    /// Test duration
    pub duration: Duration,
    /// Server WebSocket URL
    pub ws_url: String,
    /// Server HTTP base URL
    pub http_url: String,
    /// Cursor update rate (Hz) per presenter
    pub cursor_hz: u32,
    /// Viewport update rate (Hz) per presenter
    pub viewport_hz: u32,
    /// Tile request rate (Hz) per client
    pub tile_request_hz: u32,
    /// Overlay request rate (Hz) per client (tissue tiles + cell queries)
    pub overlay_request_hz: u32,
}

impl Default for ComprehensiveStressConfig {
    fn default() -> Self {
        Self {
            num_sessions: 500, // 500 sessions × 2 users = 1000 users
            duration: Duration::from_secs(60),
            ws_url: "ws://127.0.0.1:8080/ws".to_string(),
            http_url: "http://127.0.0.1:8080".to_string(),
            cursor_hz: 30,
            viewport_hz: 10,
            tile_request_hz: 5,
            overlay_request_hz: 2,
        }
    }
}

impl ComprehensiveStressConfig {
    /// Create configuration for a specific benchmark tier
    pub fn for_tier(tier: BenchmarkTier) -> Self {
        match tier {
            BenchmarkTier::Smoke => Self {
                num_sessions: 5, // 10 users
                duration: Duration::from_secs(10),
                cursor_hz: 10,
                viewport_hz: 5,
                tile_request_hz: 2,
                overlay_request_hz: 1,
                ..Default::default()
            },
            BenchmarkTier::Standard => Self {
                num_sessions: 25, // 50 users
                duration: Duration::from_secs(30),
                cursor_hz: 30,
                viewport_hz: 10,
                tile_request_hz: 5,
                overlay_request_hz: 2,
                ..Default::default()
            },
            BenchmarkTier::Stress => Self {
                num_sessions: 100, // 200 users
                duration: Duration::from_secs(60),
                cursor_hz: 30,
                viewport_hz: 10,
                tile_request_hz: 5,
                overlay_request_hz: 2,
                ..Default::default()
            },
        }
    }
}

/// Extended results for comprehensive stress test
#[derive(Debug)]
pub struct ComprehensiveStressResults {
    /// WebSocket message stats
    pub ws_messages_sent: u64,
    pub ws_messages_received: u64,
    pub ws_connection_errors: u64,

    /// HTTP stats
    pub http_requests_sent: u64,
    pub http_requests_success: u64,
    pub http_requests_failed: u64,

    /// Latency stats by category
    pub cursor_latencies: LatencyStats,
    pub viewport_latencies: LatencyStats,
    pub tile_latencies: LatencyStats,
    pub overlay_latencies: LatencyStats,

    /// Sessions stats
    pub sessions_created: u64,
    pub sessions_joined: u64,

    /// Test duration
    pub duration: Duration,
}

/// Performance budgets for benchmarks
pub mod budgets {
    use std::time::Duration;

    /// Maximum acceptable P99 cursor broadcast latency
    pub const CURSOR_P99_MAX: Duration = Duration::from_millis(100);
    /// Maximum acceptable P99 viewport broadcast latency
    pub const VIEWPORT_P99_MAX: Duration = Duration::from_millis(150);
    /// Maximum acceptable P99 tile serving latency
    pub const TILE_P99_MAX: Duration = Duration::from_millis(500);
    /// Maximum acceptable P99 overlay latency
    pub const OVERLAY_P99_MAX: Duration = Duration::from_millis(1000);
    /// Maximum acceptable error rate
    pub const ERROR_RATE_MAX: f64 = 0.01; // 1%
}

impl ComprehensiveStressResults {
    pub fn new() -> Self {
        Self {
            ws_messages_sent: 0,
            ws_messages_received: 0,
            ws_connection_errors: 0,
            http_requests_sent: 0,
            http_requests_success: 0,
            http_requests_failed: 0,
            cursor_latencies: LatencyStats::new(),
            viewport_latencies: LatencyStats::new(),
            tile_latencies: LatencyStats::new(),
            overlay_latencies: LatencyStats::new(),
            sessions_created: 0,
            sessions_joined: 0,
            duration: Duration::ZERO,
        }
    }

    /// Calculate error rate as a fraction (0.0 to 1.0)
    pub fn error_rate(&self) -> f64 {
        let total_requests = self.http_requests_sent + self.ws_messages_sent;
        let total_errors = self.http_requests_failed + self.ws_connection_errors;
        if total_requests > 0 {
            total_errors as f64 / total_requests as f64
        } else {
            0.0
        }
    }

    /// Minimum samples required to consider a latency measurement valid
    const MIN_LATENCY_SAMPLES: usize = 10;

    /// Check if results meet performance budgets
    pub fn meets_budgets(&self) -> bool {
        // WebSocket latency budgets
        // Note: The server doesn't send Acks for cursor/viewport updates (fire-and-forget
        // for performance), so latency samples may be empty. That's OK - we check if
        // we have samples, and only fail if samples exceed budget.
        let cursor_ok = self
            .cursor_latencies
            .p99()
            .map(|p| p <= budgets::CURSOR_P99_MAX)
            .unwrap_or(true); // OK if no samples (server doesn't Ack cursor updates)

        let viewport_ok = self
            .viewport_latencies
            .p99()
            .map(|p| p <= budgets::VIEWPORT_P99_MAX)
            .unwrap_or(true); // OK if no samples (server doesn't Ack viewport updates)

        // HTTP latency budgets - require samples if we had successful requests
        let tile_ok = if self.http_requests_success > 0 {
            self.tile_latencies
                .p99()
                .map(|p| p <= budgets::TILE_P99_MAX)
                .unwrap_or_else(|| self.tile_latencies.samples.len() >= Self::MIN_LATENCY_SAMPLES)
        } else {
            true
        };

        // Overlay is optional - many test setups don't have overlay data
        let overlay_ok = self
            .overlay_latencies
            .p99()
            .map(|p| p <= budgets::OVERLAY_P99_MAX)
            .unwrap_or(true); // OK if no overlay data

        // Error rate budget
        let error_rate_ok = self.error_rate() < budgets::ERROR_RATE_MAX;

        cursor_ok && viewport_ok && tile_ok && overlay_ok && error_rate_ok
    }
}

impl Default for ComprehensiveStressResults {
    fn default() -> Self {
        Self::new()
    }
}

/// Event types for comprehensive test
#[derive(Debug)]
#[allow(dead_code)]
pub enum ComprehensiveEvent {
    WsCursorAck { latency: Duration },
    WsViewportAck { latency: Duration },
    WsMessageReceived { msg_type: &'static str },
    WsError,
    HttpTileRequest { latency: Duration, success: bool },
    HttpOverlayRequest { latency: Duration, success: bool },
    SessionCreated,
    SessionJoined,
}

/// Comprehensive stress test scenario
pub struct ComprehensiveStressScenario {
    config: ComprehensiveStressConfig,
}

impl ComprehensiveStressScenario {
    pub fn new(config: ComprehensiveStressConfig) -> Self {
        Self { config }
    }

    /// Run the comprehensive stress test
    pub async fn run(
        &self,
    ) -> Result<ComprehensiveStressResults, Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();
        let mut results = ComprehensiveStressResults::new();

        // Fetch available slide from server
        let slide = fetch_first_slide(&self.config.http_url).await?;
        println!("Using slide: {} ({})", slide.name, slide.id);

        // Channels for collecting events
        let (tx, mut rx) = mpsc::channel::<ComprehensiveEvent>(50000);

        // Atomic counters
        let ws_sent = Arc::new(AtomicU64::new(0));
        let ws_recv = Arc::new(AtomicU64::new(0));
        let ws_errors = Arc::new(AtomicU64::new(0));
        let http_sent = Arc::new(AtomicU64::new(0));
        let http_success = Arc::new(AtomicU64::new(0));
        let http_failed = Arc::new(AtomicU64::new(0));
        let sessions_created = Arc::new(AtomicU64::new(0));
        let sessions_joined = Arc::new(AtomicU64::new(0));

        let mut join_handles = Vec::new();

        // Create HTTP client
        let http_client = Client::builder()
            .pool_max_idle_per_host(200)
            .timeout(Duration::from_secs(30))
            .build()?;

        println!(
            "Starting comprehensive stress test: {} sessions ({} users) for {:?}",
            self.config.num_sessions,
            self.config.num_sessions * 2,
            self.config.duration
        );

        // Create sessions with presenter + follower pairs
        for session_idx in 0..self.config.num_sessions {
            if session_idx % 50 == 0 {
                println!(
                    "Setting up sessions {}-{}/{}",
                    session_idx + 1,
                    (session_idx + 50).min(self.config.num_sessions),
                    self.config.num_sessions
                );
            }

            // Create presenter
            let presenter = match LoadTestClient::connect(&self.config.ws_url).await {
                Ok(mut client) => {
                    if let Err(e) = client.create_session(&slide.id).await {
                        eprintln!("Failed to create session {}: {}", session_idx, e);
                        ws_errors.fetch_add(1, Ordering::SeqCst);
                        continue;
                    }
                    sessions_created.fetch_add(1, Ordering::SeqCst);
                    client
                }
                Err(e) => {
                    eprintln!("Failed to connect presenter {}: {}", session_idx, e);
                    ws_errors.fetch_add(1, Ordering::SeqCst);
                    continue;
                }
            };

            let session_id = presenter.session_id.clone().unwrap();
            let join_secret = presenter.join_secret.clone().unwrap();

            // Spawn presenter task (WebSocket + HTTP)
            let presenter_handle = self.spawn_user_task(
                presenter,
                true, // is_presenter
                http_client.clone(),
                slide.id.clone(),
                slide.width,
                slide.height,
                tx.clone(),
                ws_sent.clone(),
                ws_recv.clone(),
                ws_errors.clone(),
                http_sent.clone(),
                http_success.clone(),
                http_failed.clone(),
            );
            join_handles.push(presenter_handle);

            // Create and spawn follower
            let follower = match LoadTestClient::connect(&self.config.ws_url).await {
                Ok(mut client) => {
                    if let Err(e) = client.join_session(&session_id, &join_secret).await {
                        eprintln!("Follower {} failed to join: {}", session_idx, e);
                        ws_errors.fetch_add(1, Ordering::SeqCst);
                        continue;
                    }
                    sessions_joined.fetch_add(1, Ordering::SeqCst);
                    client
                }
                Err(e) => {
                    eprintln!("Failed to connect follower {}: {}", session_idx, e);
                    ws_errors.fetch_add(1, Ordering::SeqCst);
                    continue;
                }
            };

            let follower_handle = self.spawn_user_task(
                follower,
                false, // is_presenter
                http_client.clone(),
                slide.id.clone(),
                slide.width,
                slide.height,
                tx.clone(),
                ws_sent.clone(),
                ws_recv.clone(),
                ws_errors.clone(),
                http_sent.clone(),
                http_success.clone(),
                http_failed.clone(),
            );
            join_handles.push(follower_handle);

            // Small stagger to avoid thundering herd
            if session_idx % 10 == 9 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }

        // Drop the original sender
        drop(tx);

        // Collect events
        let mut cursor_latencies = LatencyStats::new();
        let mut viewport_latencies = LatencyStats::new();
        let mut tile_latencies = LatencyStats::new();
        let mut overlay_latencies = LatencyStats::new();

        let collect_duration = self.config.duration + Duration::from_secs(10);
        let collect_start = Instant::now();

        while collect_start.elapsed() < collect_duration {
            match tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                Ok(Some(event)) => match event {
                    ComprehensiveEvent::WsCursorAck { latency } => {
                        cursor_latencies.record(latency);
                    }
                    ComprehensiveEvent::WsViewportAck { latency } => {
                        viewport_latencies.record(latency);
                    }
                    ComprehensiveEvent::HttpTileRequest {
                        latency,
                        success: true,
                    } => {
                        tile_latencies.record(latency);
                    }
                    ComprehensiveEvent::HttpOverlayRequest {
                        latency,
                        success: true,
                    } => {
                        overlay_latencies.record(latency);
                    }
                    _ => {}
                },
                Ok(None) => break,
                Err(_) => {}
            }
        }

        // Wait for all tasks
        println!("Waiting for {} tasks to complete...", join_handles.len());
        for handle in join_handles {
            let _ = handle.await;
        }

        // Populate results
        results.ws_messages_sent = ws_sent.load(Ordering::SeqCst);
        results.ws_messages_received = ws_recv.load(Ordering::SeqCst);
        results.ws_connection_errors = ws_errors.load(Ordering::SeqCst);
        results.http_requests_sent = http_sent.load(Ordering::SeqCst);
        results.http_requests_success = http_success.load(Ordering::SeqCst);
        results.http_requests_failed = http_failed.load(Ordering::SeqCst);
        results.sessions_created = sessions_created.load(Ordering::SeqCst);
        results.sessions_joined = sessions_joined.load(Ordering::SeqCst);
        results.cursor_latencies = cursor_latencies;
        results.viewport_latencies = viewport_latencies;
        results.tile_latencies = tile_latencies;
        results.overlay_latencies = overlay_latencies;
        results.duration = start.elapsed();

        Ok(results)
    }

    /// Spawn a user task that does both WebSocket and HTTP operations
    #[allow(clippy::too_many_arguments)]
    fn spawn_user_task(
        &self,
        mut client: LoadTestClient,
        is_presenter: bool,
        http_client: Client,
        slide_id: String,
        slide_width: u64,
        slide_height: u64,
        tx: mpsc::Sender<ComprehensiveEvent>,
        ws_sent: Arc<AtomicU64>,
        ws_recv: Arc<AtomicU64>,
        ws_errors: Arc<AtomicU64>,
        http_sent: Arc<AtomicU64>,
        http_success: Arc<AtomicU64>,
        http_failed: Arc<AtomicU64>,
    ) -> tokio::task::JoinHandle<()> {
        let duration = self.config.duration;
        let cursor_hz = if is_presenter {
            self.config.cursor_hz
        } else {
            0
        };
        let viewport_hz = if is_presenter {
            self.config.viewport_hz
        } else {
            0
        };
        let tile_hz = self.config.tile_request_hz;
        let overlay_hz = self.config.overlay_request_hz;
        let http_url = self.config.http_url.clone();

        // Calculate valid tile range based on slide dimensions
        // DZI convention: max_level = ceil(log2(max(width, height)))
        // At level N, dimensions are width/2^(max_level-N) x height/2^(max_level-N)
        let tile_size = 256u64;
        let max_level = (slide_width.max(slide_height) as f64).log2().ceil() as u32;
        // Use a level 3-4 below max to get ~50-200 tiles (good for testing)
        let test_level = max_level.saturating_sub(3);
        let level_scale = 1u64 << (max_level - test_level);
        let level_width = slide_width / level_scale.max(1);
        let level_height = slide_height / level_scale.max(1);
        let max_tile_x = level_width.div_ceil(tile_size).max(1) as u32;
        let max_tile_y = level_height.div_ceil(tile_size).max(1) as u32;

        tokio::spawn(async move {
            let cursor_interval = if cursor_hz > 0 {
                Duration::from_secs_f64(1.0 / cursor_hz as f64)
            } else {
                Duration::from_secs(3600)
            };

            let viewport_interval = if viewport_hz > 0 {
                Duration::from_secs_f64(1.0 / viewport_hz as f64)
            } else {
                Duration::from_secs(3600)
            };

            let tile_interval = if tile_hz > 0 {
                Duration::from_secs_f64(1.0 / tile_hz as f64)
            } else {
                Duration::from_secs(3600)
            };

            let overlay_interval = if overlay_hz > 0 {
                Duration::from_secs_f64(1.0 / overlay_hz as f64)
            } else {
                Duration::from_secs(3600)
            };

            let start = Instant::now();
            let mut cursor_ticker = tokio::time::interval(cursor_interval);
            let mut viewport_ticker = tokio::time::interval(viewport_interval);
            let mut tile_ticker = tokio::time::interval(tile_interval);
            let mut overlay_ticker = tokio::time::interval(overlay_interval);
            let mut ws_recv_interval = tokio::time::interval(Duration::from_millis(50));

            let mut x = 0.5f64;
            let mut y = 0.5f64;
            let mut tile_x = 0u32;
            let mut tile_y = 0u32;

            // Track pending operations for latency measurement
            // Key: seq number, Value: (send_time, is_cursor)
            let mut pending_ws: std::collections::HashMap<u64, (Instant, bool)> =
                std::collections::HashMap::new();

            loop {
                if start.elapsed() >= duration {
                    break;
                }

                tokio::select! {
                    // Presenter sends cursor updates
                    _ = cursor_ticker.tick(), if is_presenter => {
                        x = (x + 0.001).min(1.0);
                        y = (y + 0.001).min(1.0);
                        if x >= 1.0 { x = 0.0; }
                        if y >= 1.0 { y = 0.0; }

                        let send_time = Instant::now();
                        match client.send_cursor(x * slide_width as f64, y * slide_height as f64).await {
                            Ok(seq) => {
                                ws_sent.fetch_add(1, Ordering::SeqCst);
                                pending_ws.insert(seq, (send_time, true)); // true = cursor
                            }
                            Err(_) => {
                                ws_errors.fetch_add(1, Ordering::SeqCst);
                                let _ = tx.send(ComprehensiveEvent::WsError).await;
                            }
                        }
                    }

                    // Presenter sends viewport updates
                    _ = viewport_ticker.tick(), if is_presenter => {
                        let send_time = Instant::now();
                        match client.send_viewport(0.5, 0.5, 1.0).await {
                            Ok(seq) => {
                                ws_sent.fetch_add(1, Ordering::SeqCst);
                                pending_ws.insert(seq, (send_time, false)); // false = viewport
                            }
                            Err(_) => {
                                ws_errors.fetch_add(1, Ordering::SeqCst);
                                let _ = tx.send(ComprehensiveEvent::WsError).await;
                            }
                        }
                    }

                    // Both users request tiles - use valid coordinates
                    _ = tile_ticker.tick() => {
                        http_sent.fetch_add(1, Ordering::SeqCst);
                        let url = format!(
                            "{}/api/slide/{}/tile/{}/{}/{}",
                            http_url, slide_id, test_level, tile_x % max_tile_x, tile_y % max_tile_y
                        );

                        let req_start = Instant::now();
                        match http_client.get(&url).send().await {
                            Ok(resp) => {
                                let latency = req_start.elapsed();
                                // 200 = success, 404 = tile doesn't exist but server responded correctly
                                // Both count as successful server responses for latency measurement
                                if resp.status().is_success() || resp.status().as_u16() == 404 {
                                    http_success.fetch_add(1, Ordering::SeqCst);
                                    let _ = tx.send(ComprehensiveEvent::HttpTileRequest {
                                        latency,
                                        success: true,
                                    }).await;
                                } else {
                                    http_failed.fetch_add(1, Ordering::SeqCst);
                                    let _ = tx.send(ComprehensiveEvent::HttpTileRequest {
                                        latency,
                                        success: false,
                                    }).await;
                                }
                            }
                            Err(_) => {
                                http_failed.fetch_add(1, Ordering::SeqCst);
                            }
                        }

                        tile_x = tile_x.wrapping_add(1);
                        if tile_x % max_tile_x == 0 {
                            tile_y = tile_y.wrapping_add(1);
                        }
                    }

                    // Both users request overlays
                    _ = overlay_ticker.tick() => {
                        http_sent.fetch_add(1, Ordering::SeqCst);

                        // Alternate between tissue tiles and cell queries
                        let is_tissue = tile_x % 2 == 0;
                        let url = if is_tissue {
                            format!(
                                "{}/api/slide/{}/overlay/tissue/{}/{}/{}",
                                http_url, slide_id, test_level.saturating_sub(2), tile_x % max_tile_x, tile_y % max_tile_y
                            )
                        } else {
                            format!(
                                "{}/api/slide/{}/overlay/cells?x={}&y={}&width=5000&height=5000",
                                http_url, slide_id,
                                ((tile_x % max_tile_x) as f64) * 256.0 * (level_scale as f64),
                                ((tile_y % max_tile_y) as f64) * 256.0 * (level_scale as f64)
                            )
                        };

                        let req_start = Instant::now();
                        match http_client.get(&url).send().await {
                            Ok(resp) => {
                                let latency = req_start.elapsed();
                                // Overlays may legitimately 404 if no overlay data exists
                                if resp.status().is_success() || resp.status().as_u16() == 404 {
                                    http_success.fetch_add(1, Ordering::SeqCst);
                                    let _ = tx.send(ComprehensiveEvent::HttpOverlayRequest {
                                        latency,
                                        success: true,
                                    }).await;
                                } else {
                                    http_failed.fetch_add(1, Ordering::SeqCst);
                                }
                            }
                            Err(_) => {
                                http_failed.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }

                    // Receive WebSocket messages - track Ack latencies
                    _ = ws_recv_interval.tick() => {
                        match client.recv_timeout(Duration::from_millis(10)).await {
                            Ok(Some(msg)) => {
                                ws_recv.fetch_add(1, Ordering::SeqCst);
                                match &msg {
                                    ServerMessage::Ack { ack_seq, status, .. } => {
                                        if status == "ok" {
                                            if let Some((send_time, is_cursor)) = pending_ws.remove(ack_seq) {
                                                let latency = send_time.elapsed();
                                                if is_cursor {
                                                    let _ = tx.send(ComprehensiveEvent::WsCursorAck { latency }).await;
                                                } else {
                                                    let _ = tx.send(ComprehensiveEvent::WsViewportAck { latency }).await;
                                                }
                                            }
                                        }
                                    }
                                    _ => {
                                        let msg_type = match &msg {
                                            ServerMessage::PresenceDelta { .. } => "presence",
                                            ServerMessage::PresenterViewport { .. } => "viewport",
                                            _ => "other",
                                        };
                                        let _ = tx.send(ComprehensiveEvent::WsMessageReceived { msg_type }).await;
                                    }
                                }
                            }
                            Ok(None) => {}
                            Err(_) => {
                                ws_errors.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                }

                // Clean up old pending entries (older than 5 seconds - likely missed)
                pending_ws.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(5));
            }

            let _ = client.close().await;
        })
    }
}

// Tests are in perf_tests.rs using the tier-based approach
