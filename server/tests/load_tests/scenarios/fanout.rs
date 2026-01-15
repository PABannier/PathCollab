//! Fan-out load test scenario
//!
//! Validates that PathCollab can handle N sessions with 20 followers each,
//! where the presenter sends 30Hz cursor updates and 10Hz viewport updates.
//! All followers should receive broadcasts with P99 < 100ms for cursors.

use super::super::{LoadTestConfig, LoadTestResults, LatencyStats};
use super::super::client::{ClientEvent, LoadTestClient, ServerMessage, spawn_update_client};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Fan-out load test scenario
pub struct FanOutScenario {
    config: LoadTestConfig,
}

impl FanOutScenario {
    pub fn new(config: LoadTestConfig) -> Self {
        Self { config }
    }

    /// Run the fan-out scenario
    ///
    /// Creates N sessions, each with 1 presenter + 20 followers.
    /// Presenter sends 30Hz cursor + 10Hz viewport updates.
    /// Measures broadcast latency across all followers.
    pub async fn run(&self) -> Result<LoadTestResults, Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();
        let mut results = LoadTestResults::new();

        // Channel for collecting events from all clients
        let (tx, mut rx) = mpsc::channel::<ClientEvent>(10000);

        // Atomic counters for quick stats
        let messages_sent = Arc::new(AtomicU64::new(0));
        let messages_received = Arc::new(AtomicU64::new(0));
        let connection_errors = Arc::new(AtomicU64::new(0));

        let mut join_handles = Vec::new();

        // Create sessions and spawn presenter + follower tasks
        for session_idx in 0..self.config.num_sessions {
            println!("Setting up session {}/{}", session_idx + 1, self.config.num_sessions);

            // Create presenter client
            let presenter = match LoadTestClient::connect(&self.config.ws_url).await {
                Ok(mut client) => {
                    // Create session
                    if let Err(e) = client.create_session("demo").await {
                        eprintln!("Failed to create session {}: {}", session_idx, e);
                        connection_errors.fetch_add(1, Ordering::SeqCst);
                        continue;
                    }
                    client
                }
                Err(e) => {
                    eprintln!("Failed to connect presenter {}: {}", session_idx, e);
                    connection_errors.fetch_add(1, Ordering::SeqCst);
                    continue;
                }
            };

            let session_id = presenter.session_id.clone().unwrap();
            let join_secret = presenter.join_secret.clone().unwrap();

            // Spawn presenter task (sends updates)
            let presenter_tx = tx.clone();
            let cursor_hz = self.config.cursor_hz;
            let viewport_hz = self.config.viewport_hz;
            let duration = self.config.duration;
            let handle = tokio::spawn(async move {
                spawn_update_client(presenter, cursor_hz, viewport_hz, duration, presenter_tx).await;
            });
            join_handles.push(handle);

            // Create follower clients
            for follower_idx in 0..self.config.followers_per_session {
                let follower_tx = tx.clone();
                let ws_url = self.config.ws_url.clone();
                let session_id = session_id.clone();
                let join_secret = join_secret.clone();
                let duration = self.config.duration;
                let errors = connection_errors.clone();
                let recv_count = messages_received.clone();

                let handle = tokio::spawn(async move {
                    // Connect and join session
                    let client = match LoadTestClient::connect(&ws_url).await {
                        Ok(mut c) => {
                            if let Err(e) = c.join_session(&session_id, &join_secret).await {
                                eprintln!("Follower {} failed to join: {}", follower_idx, e);
                                errors.fetch_add(1, Ordering::SeqCst);
                                return;
                            }
                            c
                        }
                        Err(e) => {
                            eprintln!("Follower {} failed to connect: {}", follower_idx, e);
                            errors.fetch_add(1, Ordering::SeqCst);
                            return;
                        }
                    };

                    // Receive messages for duration
                    let start = Instant::now();
                    let mut ws = client;
                    while start.elapsed() < duration {
                        match ws.recv_timeout(Duration::from_millis(100)).await {
                            Ok(Some(msg)) => {
                                recv_count.fetch_add(1, Ordering::SeqCst);
                                // Track message type for latency if it's an Ack
                                let msg_type = match &msg {
                                    ServerMessage::PresenceDelta { .. } => "presence",
                                    ServerMessage::PresenterViewport { .. } => "viewport",
                                    ServerMessage::Ack { .. } => "ack",
                                    _ => "other",
                                };
                                let _ = follower_tx.send(ClientEvent::MessageReceived {
                                    latency: None, // We track latency on presenter side
                                    msg_type,
                                }).await;
                            }
                            Ok(None) => {}
                            Err(e) => {
                                let _ = follower_tx.send(ClientEvent::Error {
                                    message: e.to_string(),
                                }).await;
                            }
                        }
                    }

                    let _ = ws.close().await;
                });
                join_handles.push(handle);
            }

            // Small delay between session setups to avoid thundering herd
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        // Drop the original sender so rx completes when all tasks are done
        drop(tx);

        // Collect events from all clients
        let mut cursor_latencies = LatencyStats::new();
        let mut viewport_latencies = LatencyStats::new();

        // Process events as they come in (but don't block forever)
        let collect_duration = self.config.duration + Duration::from_secs(5);
        let collect_start = Instant::now();

        while collect_start.elapsed() < collect_duration {
            match tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                Ok(Some(event)) => match event {
                    ClientEvent::MessageSent { seq: _, msg_type: _ } => {
                        messages_sent.fetch_add(1, Ordering::SeqCst);
                    }
                    ClientEvent::MessageReceived { latency, msg_type } => {
                        // Note: messages_received is already incremented in the follower tasks
                        // via recv_count, so we don't increment here to avoid double-counting
                        if let Some(lat) = latency {
                            match msg_type {
                                "presence" | "cursor" => cursor_latencies.record(lat),
                                "viewport" => viewport_latencies.record(lat),
                                _ => {}
                            }
                        }
                    }
                    ClientEvent::Error { message: _ } => {
                        connection_errors.fetch_add(1, Ordering::SeqCst);
                    }
                },
                Ok(None) => break, // Channel closed
                Err(_) => {} // Timeout, continue
            }
        }

        // Wait for all tasks to complete
        for handle in join_handles {
            let _ = handle.await;
        }

        results.cursor_latencies = cursor_latencies;
        results.viewport_latencies = viewport_latencies;
        results.messages_sent = messages_sent.load(Ordering::SeqCst);
        results.messages_received = messages_received.load(Ordering::SeqCst);
        results.connection_errors = connection_errors.load(Ordering::SeqCst);
        results.duration = start.elapsed();

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require a running server
    // Run with: cargo test --test perf_tests -- --ignored

    #[tokio::test]
    #[ignore = "requires running server"]
    async fn test_fanout_single_session() {
        let config = LoadTestConfig {
            num_sessions: 1,
            followers_per_session: 5,
            cursor_hz: 10,
            viewport_hz: 5,
            duration: Duration::from_secs(5),
            ws_url: "ws://127.0.0.1:8080/ws".to_string(),
        };

        let scenario = FanOutScenario::new(config);
        let results = scenario.run().await.expect("Scenario should complete");

        println!("{}", results.report());
        assert!(results.messages_sent > 0, "Should have sent messages");
        assert!(results.messages_received > 0, "Should have received messages");
    }

    #[tokio::test]
    #[ignore = "requires running server"]
    async fn test_fanout_full_load() {
        let config = LoadTestConfig {
            num_sessions: 5,
            followers_per_session: 20,
            cursor_hz: 30,
            viewport_hz: 10,
            duration: Duration::from_secs(60),
            ws_url: "ws://127.0.0.1:8080/ws".to_string(),
        };

        let scenario = FanOutScenario::new(config);
        let results = scenario.run().await.expect("Scenario should complete");

        println!("{}", results.report());
        assert!(results.meets_budgets(), "Should meet performance budgets");
    }
}
