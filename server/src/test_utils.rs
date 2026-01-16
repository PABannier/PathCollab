//! Test Utilities Module
//!
//! Provides helper functions, fixtures, and utilities for testing the PathCollab server.
//! This module is only compiled when running tests.

#![cfg(test)]

use crate::protocol::{
    ClientMessage, LayerVisibility, Participant, ParticipantRole, ServerMessage, SessionSnapshot,
    SlideInfo, Viewport,
};
use crate::server::AppState;
use crate::session::manager::SessionManager;
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

// ============================================================================
// Test Context
// ============================================================================

/// Test context that holds all test fixtures and state
pub struct TestContext {
    pub app_state: AppState,
    pub router: Router,
}

impl TestContext {
    /// Create a new test context with default state
    pub fn new() -> Self {
        let app_state = AppState::new();
        let router = create_test_router(app_state.clone());
        Self { app_state, router }
    }

    /// Get a reference to the session manager
    pub fn session_manager(&self) -> &Arc<SessionManager> {
        &self.app_state.session_manager
    }

    /// Create a test session and return session info with secrets
    pub async fn create_test_session(&self) -> TestSession {
        let slide = create_test_slide();
        let presenter_connection_id = Uuid::new_v4();

        let (session, join_secret, presenter_key) = self
            .app_state
            .session_manager
            .create_session(slide, presenter_connection_id)
            .await
            .expect("Failed to create test session");

        let snapshot = self
            .app_state
            .session_manager
            .get_session(&session.id)
            .await
            .expect("Failed to get session snapshot");

        TestSession {
            id: session.id,
            join_secret,
            presenter_key,
            presenter_id: session.presenter_id,
            snapshot,
        }
    }

    /// Make an HTTP request to the test router
    pub async fn request(&self, request: Request<Body>) -> axum::response::Response {
        self.router
            .clone()
            .oneshot(request)
            .await
            .expect("Failed to execute request")
    }

    /// Make a GET request and parse JSON response
    pub async fn get_json<T: DeserializeOwned>(&self, uri: &str) -> (StatusCode, Option<T>) {
        let request = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .expect("Failed to build request");

        let response = self.request(request).await;
        let status = response.status();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");

        let json: Option<T> = serde_json::from_slice(&body).ok();
        (status, json)
    }

    /// Make a POST request with JSON body and parse JSON response
    pub async fn post_json<T: DeserializeOwned>(
        &self,
        uri: &str,
        body: impl serde::Serialize,
    ) -> (StatusCode, Option<T>) {
        let body_bytes = serde_json::to_vec(&body).expect("Failed to serialize body");

        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json")
            .body(Body::from(body_bytes))
            .expect("Failed to build request");

        let response = self.request(request).await;
        let status = response.status();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");

        let json: Option<T> = serde_json::from_slice(&body).ok();
        (status, json)
    }

    /// Make a POST request with raw bytes
    pub async fn post_bytes<T: DeserializeOwned>(
        &self,
        uri: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> (StatusCode, Option<T>) {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", content_type)
            .body(Body::from(body))
            .expect("Failed to build request");

        let response = self.request(request).await;
        let status = response.status();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");

        let json: Option<T> = serde_json::from_slice(&body).ok();
        (status, json)
    }
}

impl Default for TestContext {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Test Session
// ============================================================================

/// A test session with all relevant data
pub struct TestSession {
    pub id: String,
    pub join_secret: String,
    pub presenter_key: String,
    pub presenter_id: Uuid,
    pub snapshot: SessionSnapshot,
}

impl TestSession {
    /// Get the presenter participant
    pub fn presenter(&self) -> &Participant {
        &self.snapshot.presenter
    }

    /// Get the join URL path
    pub fn join_path(&self) -> String {
        format!("/join/{}/{}", self.id, self.join_secret)
    }
}

// ============================================================================
// Test Router Setup
// ============================================================================

/// Create a test router with all routes configured
fn create_test_router(app_state: AppState) -> Router {
    use axum::routing::get;
    use tower_http::cors::{Any, CorsLayer};

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_handler))
        .nest("/api/overlay", crate::overlay::overlay_routes())
        .layer(cors)
        .with_state(app_state)
}

/// Health check handler for tests
async fn health_handler() -> &'static str {
    "ok"
}

// ============================================================================
// Mock Data Factories
// ============================================================================

/// Create a test slide with standard dimensions
pub fn create_test_slide() -> SlideInfo {
    SlideInfo {
        id: format!("test-slide-{}", Uuid::new_v4().to_string()[..8].to_string()),
        name: "Test Slide".to_string(),
        width: 100000,
        height: 100000,
        tile_size: 256,
        num_levels: 10,
        tile_url_template: "/api/slide/{id}/tile/{level}/{x}/{y}".to_string(),
        has_overlay: false,
    }
}

/// Create a test slide with custom dimensions
pub fn create_test_slide_with_size(width: u64, height: u64) -> SlideInfo {
    SlideInfo {
        id: format!("test-slide-{}", Uuid::new_v4().to_string()[..8].to_string()),
        name: "Test Slide".to_string(),
        width,
        height,
        tile_size: 256,
        num_levels: calculate_levels(width.max(height)),
        tile_url_template: "/api/slide/{id}/tile/{level}/{x}/{y}".to_string(),
        has_overlay: false,
    }
}

/// Calculate the number of pyramid levels for a given dimension
fn calculate_levels(max_dimension: u64) -> u32 {
    let mut levels = 1u32;
    let mut size = 256u64;
    while size < max_dimension {
        size *= 2;
        levels += 1;
    }
    levels
}

/// Create a test viewport centered at (0.5, 0.5) with zoom 1.0
pub fn create_test_viewport() -> Viewport {
    Viewport {
        center_x: 0.5,
        center_y: 0.5,
        zoom: 1.0,
        timestamp: current_timestamp_millis(),
    }
}

/// Create a test viewport with custom values
pub fn create_test_viewport_at(center_x: f64, center_y: f64, zoom: f64) -> Viewport {
    Viewport {
        center_x,
        center_y,
        zoom,
        timestamp: current_timestamp_millis(),
    }
}

/// Create default layer visibility settings
pub fn create_test_layer_visibility() -> LayerVisibility {
    LayerVisibility::default()
}

/// Create a test participant
pub fn create_test_participant(role: ParticipantRole) -> Participant {
    Participant {
        id: Uuid::new_v4(),
        name: generate_test_name(),
        color: get_test_color(0),
        role,
        connected_at: current_timestamp_millis(),
    }
}

/// Generate a random test name
pub fn generate_test_name() -> String {
    format!("TestUser_{}", &Uuid::new_v4().to_string()[..6])
}

/// Get a test color by index
pub fn get_test_color(index: usize) -> String {
    const COLORS: [&str; 8] = [
        "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
    ];
    COLORS[index % COLORS.len()].to_string()
}

/// Get current timestamp in milliseconds
pub fn current_timestamp_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ============================================================================
// WebSocket Test Helpers
// ============================================================================

/// Mock WebSocket message pair for testing
pub struct MockWsExchange {
    pub client_message: ClientMessage,
    pub expected_responses: Vec<ExpectedResponse>,
}

/// Expected response matcher
pub enum ExpectedResponse {
    /// Expect an Ack with specific status
    Ack { seq: u64, ok: bool },
    /// Expect a SessionCreated message
    SessionCreated,
    /// Expect a SessionJoined message
    SessionJoined,
    /// Expect a SessionError message
    SessionError,
    /// Expect a PresenterViewport message
    PresenterViewport,
    /// Expect a LayerState message
    LayerState,
    /// Expect a Pong message
    Pong,
    /// Custom matcher
    Custom(Box<dyn Fn(&ServerMessage) -> bool + Send + Sync>),
}

impl ExpectedResponse {
    /// Check if a server message matches this expected response
    pub fn matches(&self, msg: &ServerMessage) -> bool {
        match self {
            ExpectedResponse::Ack { seq, ok } => {
                matches!(
                    msg,
                    ServerMessage::Ack {
                        ack_seq,
                        status,
                        ..
                    } if *ack_seq == *seq && (*ok == (*status == crate::protocol::AckStatus::Ok))
                )
            }
            ExpectedResponse::SessionCreated => {
                matches!(msg, ServerMessage::SessionCreated { .. })
            }
            ExpectedResponse::SessionJoined => {
                matches!(msg, ServerMessage::SessionJoined { .. })
            }
            ExpectedResponse::SessionError => {
                matches!(msg, ServerMessage::SessionError { .. })
            }
            ExpectedResponse::PresenterViewport => {
                matches!(msg, ServerMessage::PresenterViewport { .. })
            }
            ExpectedResponse::LayerState => {
                matches!(msg, ServerMessage::LayerState { .. })
            }
            ExpectedResponse::Pong => {
                matches!(msg, ServerMessage::Pong)
            }
            ExpectedResponse::Custom(matcher) => matcher(msg),
        }
    }
}

/// Create a CreateSession client message
pub fn create_session_message(slide_id: &str, seq: u64) -> ClientMessage {
    ClientMessage::CreateSession {
        slide_id: slide_id.to_string(),
        seq,
    }
}

/// Create a JoinSession client message
pub fn join_session_message(
    session_id: &str,
    join_secret: &str,
    seq: u64,
) -> ClientMessage {
    ClientMessage::JoinSession {
        session_id: session_id.to_string(),
        join_secret: join_secret.to_string(),
        last_seen_rev: None,
        seq,
    }
}

/// Create a CursorUpdate client message
pub fn cursor_update_message(x: f64, y: f64, seq: u64) -> ClientMessage {
    ClientMessage::CursorUpdate { x, y, seq }
}

/// Create a ViewportUpdate client message
pub fn viewport_update_message(
    center_x: f64,
    center_y: f64,
    zoom: f64,
    seq: u64,
) -> ClientMessage {
    ClientMessage::ViewportUpdate {
        center_x,
        center_y,
        zoom,
        seq,
    }
}

/// Create a LayerUpdate client message
pub fn layer_update_message(visibility: LayerVisibility, seq: u64) -> ClientMessage {
    ClientMessage::LayerUpdate { visibility, seq }
}

/// Create a Ping client message
pub fn ping_message(seq: u64) -> ClientMessage {
    ClientMessage::Ping { seq }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/// Assert that a session exists and is active
pub async fn assert_session_exists(ctx: &TestContext, session_id: &str) {
    let result = ctx.session_manager().get_session(session_id).await;
    assert!(
        result.is_ok(),
        "Session {} should exist but got error: {:?}",
        session_id,
        result.err()
    );
}

/// Assert that a session does not exist
pub async fn assert_session_not_exists(ctx: &TestContext, session_id: &str) {
    let result = ctx.session_manager().get_session(session_id).await;
    assert!(
        result.is_err(),
        "Session {} should not exist but was found",
        session_id
    );
}

/// Assert that a session has a specific number of followers
pub async fn assert_follower_count(ctx: &TestContext, session_id: &str, expected: usize) {
    let snapshot = ctx
        .session_manager()
        .get_session(session_id)
        .await
        .expect("Session should exist");
    assert_eq!(
        snapshot.followers.len(),
        expected,
        "Expected {} followers but got {}",
        expected,
        snapshot.followers.len()
    );
}

// ============================================================================
// Logging Configuration
// ============================================================================

/// Initialize test logging with detailed output
pub fn init_test_logging() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pathcollab=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_test_writer())
        .try_init();
}

// ============================================================================
// Mock Protobuf Data
// ============================================================================

/// Create a minimal valid overlay protobuf for testing
/// This creates a simple overlay with a few cells for testing upload/parsing
pub fn create_test_overlay_bytes() -> Vec<u8> {
    // For now, return empty bytes - the actual protobuf structure
    // would need to match the schema defined in overlay.proto
    // Tests using this should mock the parser behavior
    Vec::new()
}

// ============================================================================
// Tests for Test Utilities
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_context_creation() {
        let ctx = TestContext::new();
        assert_eq!(ctx.session_manager().session_count_async().await, 0);
    }

    #[tokio::test]
    async fn test_create_test_session() {
        let ctx = TestContext::new();
        let session = ctx.create_test_session().await;

        assert!(!session.id.is_empty());
        assert!(!session.join_secret.is_empty());
        assert!(!session.presenter_key.is_empty());
        assert_eq!(ctx.session_manager().session_count_async().await, 1);
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let ctx = TestContext::new();
        let (status, body) = ctx.get_json::<serde_json::Value>("/health").await;

        assert_eq!(status, StatusCode::OK);
    }

    #[test]
    fn test_create_test_slide() {
        let slide = create_test_slide();
        assert_eq!(slide.width, 100000);
        assert_eq!(slide.height, 100000);
        assert_eq!(slide.tile_size, 256);
    }

    #[test]
    fn test_create_test_viewport() {
        let viewport = create_test_viewport();
        assert_eq!(viewport.center_x, 0.5);
        assert_eq!(viewport.center_y, 0.5);
        assert_eq!(viewport.zoom, 1.0);
    }

    #[test]
    fn test_calculate_levels() {
        assert_eq!(calculate_levels(256), 1);
        assert_eq!(calculate_levels(512), 2);
        assert_eq!(calculate_levels(1024), 3);
        assert_eq!(calculate_levels(100000), 10);
    }

    #[test]
    fn test_expected_response_matching() {
        let ack_ok = ServerMessage::Ack {
            ack_seq: 1,
            status: crate::protocol::AckStatus::Ok,
            reason: None,
        };
        let ack_rejected = ServerMessage::Ack {
            ack_seq: 1,
            status: crate::protocol::AckStatus::Rejected,
            reason: Some("test".to_string()),
        };

        assert!(ExpectedResponse::Ack { seq: 1, ok: true }.matches(&ack_ok));
        assert!(!ExpectedResponse::Ack { seq: 1, ok: true }.matches(&ack_rejected));
        assert!(ExpectedResponse::Ack { seq: 1, ok: false }.matches(&ack_rejected));
        assert!(ExpectedResponse::Pong.matches(&ServerMessage::Pong));
    }
}
