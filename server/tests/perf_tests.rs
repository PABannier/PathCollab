//! Load test entry point
//!
//! Run with: cargo test --test perf_tests -- --ignored --nocapture
//! Or for quick test: cargo test --test perf_tests test_connection -- --ignored --nocapture
//!
//! Available tests:
//! - test_connection: Quick connectivity test
//! - test_create_session: Session creation test
//! - test_fanout_minimal: Quick fan-out test (1 session, 3 followers, 3s)
//! - test_fanout_standard: Standard fan-out (5 sessions, 20 followers, 30s)
//! - test_fanout_extended: Extended fan-out (5 sessions, 20 followers, 5min)
//! - test_overlay_stress_minimal: Quick overlay stress test (5 clients, 5s)
//! - test_overlay_stress_standard: Standard overlay stress (50 clients, 30s)
//! - test_comprehensive_minimal: Quick comprehensive test (10 users, 10s)
//! - test_comprehensive_100_users: 100 users stress test (50 sessions, 30s)
//! - test_comprehensive_1000_users: Full 1000 users stress test (500 sessions, 60s)

#![allow(clippy::collapsible_if)]

mod load_tests;

use load_tests::scenarios::{
    ComprehensiveStressConfig, ComprehensiveStressScenario, FanOutScenario, OverlayStressConfig,
    OverlayStressScenario,
};
use load_tests::{LoadTestConfig, LoadTestResults};
use std::time::Duration;

/// Quick connectivity test
#[tokio::test]
#[ignore = "requires running server"]
async fn test_connection() {
    use load_tests::client::LoadTestClient;

    let url = "ws://127.0.0.1:8080/ws";
    let client: LoadTestClient = LoadTestClient::connect(url)
        .await
        .expect("Should connect to server");

    println!("Connected successfully to {}", url);
    client.close().await.expect("Should close cleanly");
}

/// Quick session creation test
#[tokio::test]
#[ignore = "requires running server"]
async fn test_create_session() {
    use load_tests::client::{LoadTestClient, fetch_first_slide};

    // Fetch available slide from server
    let slide = fetch_first_slide("http://127.0.0.1:8080")
        .await
        .expect("Should have slides available");
    println!("Using slide: {} ({})", slide.name, slide.id);

    let url = "ws://127.0.0.1:8080/ws";
    let mut client: LoadTestClient = LoadTestClient::connect(url)
        .await
        .expect("Should connect to server");

    client
        .create_session(&slide.id)
        .await
        .expect("Should create session");

    println!("Session created: {:?}", client.session_id);
    assert!(client.session_id.is_some());
    assert!(client.join_secret.is_some());
    assert!(client.presenter_key.is_some());

    client.close().await.expect("Should close cleanly");
}

/// Quick fan-out test with minimal load
#[tokio::test]
#[ignore = "requires running server"]
async fn test_fanout_minimal() {
    let config = LoadTestConfig {
        num_sessions: 1,
        followers_per_session: 3,
        cursor_hz: 10,
        viewport_hz: 5,
        duration: Duration::from_secs(3),
        ..Default::default()
    };

    let scenario = FanOutScenario::new(config);
    let results: LoadTestResults = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());
    assert!(results.messages_sent > 0, "Should have sent messages");
}

/// Standard fan-out test: 5 sessions, 20 followers each, 30 seconds
#[tokio::test]
#[ignore = "requires running server"]
async fn test_fanout_standard() {
    let config = LoadTestConfig {
        num_sessions: 5,
        followers_per_session: 20,
        cursor_hz: 30,
        viewport_hz: 10,
        duration: Duration::from_secs(30),
        ..Default::default()
    };

    let scenario = FanOutScenario::new(config);
    let results: LoadTestResults = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // Verify basic functionality
    assert!(results.messages_sent > 0, "Should have sent messages");
    assert!(
        results.messages_received > 0,
        "Should have received messages"
    );

    // Check performance budgets
    if !results.meets_budgets() {
        println!("WARNING: Performance budgets exceeded!");
        // Don't fail the test yet, just warn
    }
}

/// Extended fan-out test: 5 sessions, 20 followers each, 5 minutes
#[tokio::test]
#[ignore = "requires running server - long running"]
async fn test_fanout_extended() {
    let config = LoadTestConfig {
        num_sessions: 5,
        followers_per_session: 20,
        cursor_hz: 30,
        viewport_hz: 10,
        duration: Duration::from_secs(300), // 5 minutes
        ..Default::default()
    };

    let scenario = FanOutScenario::new(config);
    let results: LoadTestResults = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // This is the primary performance validation
    assert!(
        results.meets_budgets(),
        "Should meet performance budgets under sustained load"
    );
}

/// Quick overlay stress test: 5 clients, 5 seconds
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

/// Standard overlay stress test: 50 clients, 30 seconds
#[tokio::test]
#[ignore = "requires running server"]
async fn test_overlay_stress_standard() {
    let config = OverlayStressConfig {
        num_clients: 50,
        duration: Duration::from_secs(30),
        tissue_tile_hz: 10,
        cell_query_hz: 2,
        ..Default::default()
    };

    let scenario = OverlayStressScenario::new(config);
    let results = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // Basic validation - ensure we actually did work
    assert!(results.base.messages_sent > 0, "Should have sent requests");

    // Most requests should succeed (allow for 404s on non-existent overlays)
    let success_rate = (results.success_count + results.not_found_count) as f64
        / results.base.messages_sent as f64;
    assert!(
        success_rate > 0.95,
        "Success rate should be > 95%, was {:.1}%",
        success_rate * 100.0
    );
}

// ============================================================================
// Comprehensive Stress Tests
// ============================================================================

/// Quick comprehensive test: 10 users (5 sessions), 10 seconds
#[tokio::test]
#[ignore = "requires running server"]
async fn test_comprehensive_minimal() {
    let config = ComprehensiveStressConfig {
        num_sessions: 5, // 10 users
        duration: Duration::from_secs(10),
        cursor_hz: 10,
        viewport_hz: 5,
        tile_request_hz: 2,
        overlay_request_hz: 1,
        ..Default::default()
    };

    let scenario = ComprehensiveStressScenario::new(config);
    let results = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());
    assert!(results.ws_messages_sent > 0, "Should have sent WS messages");
    assert!(
        results.http_requests_sent > 0,
        "Should have sent HTTP requests"
    );
}

/// 100 users comprehensive test: 50 sessions × 2 users, 30 seconds
#[tokio::test]
#[ignore = "requires running server"]
async fn test_comprehensive_100_users() {
    let config = ComprehensiveStressConfig {
        num_sessions: 50, // 100 users
        duration: Duration::from_secs(30),
        cursor_hz: 30,
        viewport_hz: 10,
        tile_request_hz: 5,
        overlay_request_hz: 2,
        ..Default::default()
    };

    let scenario = ComprehensiveStressScenario::new(config);
    let results = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // Basic validation
    assert!(results.ws_messages_sent > 0, "Should have sent WS messages");
    assert!(
        results.http_requests_sent > 0,
        "Should have sent HTTP requests"
    );

    // Check we created and joined sessions successfully
    assert!(
        results.sessions_created >= 40,
        "Should have created at least 40 sessions (got {})",
        results.sessions_created
    );
    assert!(
        results.sessions_joined >= 40,
        "Should have at least 40 followers (got {})",
        results.sessions_joined
    );
}

/// Full 1000 users stress test: 500 sessions × 2 users, 60 seconds
/// This is the primary performance validation for production readiness.
#[tokio::test]
#[ignore = "requires running server - long running"]
async fn test_comprehensive_1000_users() {
    let config = ComprehensiveStressConfig {
        num_sessions: 500, // 1000 users
        duration: Duration::from_secs(60),
        cursor_hz: 30,
        viewport_hz: 10,
        tile_request_hz: 5,
        overlay_request_hz: 2,
        ..Default::default()
    };

    let scenario = ComprehensiveStressScenario::new(config);
    let results = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // This is the primary performance validation
    assert!(
        results.meets_budgets(),
        "Should meet performance budgets under 1000 user load"
    );

    // Verify we actually achieved the target load
    assert!(
        results.sessions_created >= 450,
        "Should have created at least 450 sessions (got {})",
        results.sessions_created
    );
    assert!(
        results.sessions_joined >= 450,
        "Should have at least 450 followers (got {})",
        results.sessions_joined
    );
}
