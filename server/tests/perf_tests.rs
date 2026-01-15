//! Load test entry point
//!
//! Run with: cargo test --test perf_tests -- --ignored --nocapture
//! Or for quick test: cargo test --test perf_tests test_connection -- --ignored --nocapture

mod load_tests;

use load_tests::{LoadTestConfig, LoadTestResults};
use load_tests::scenarios::FanOutScenario;
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
    use load_tests::client::LoadTestClient;

    let url = "ws://127.0.0.1:8080/ws";
    let mut client: LoadTestClient = LoadTestClient::connect(url)
        .await
        .expect("Should connect to server");

    client
        .create_session("demo")
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
        ws_url: "ws://127.0.0.1:8080/ws".to_string(),
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
        ws_url: "ws://127.0.0.1:8080/ws".to_string(),
    };

    let scenario = FanOutScenario::new(config);
    let results: LoadTestResults = scenario.run().await.expect("Scenario should complete");

    println!("{}", results.report());

    // Verify basic functionality
    assert!(results.messages_sent > 0, "Should have sent messages");
    assert!(results.messages_received > 0, "Should have received messages");

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
        ws_url: "ws://127.0.0.1:8080/ws".to_string(),
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
