//! Common Test Utilities for Integration Tests
//!
//! Shared helpers used across integration test modules.

use async_trait::async_trait;
use axum::{Json, Router, routing::get};
use pathcollab_server::protocol::SlideInfo;
use pathcollab_server::server::AppState;
use pathcollab_server::{SlideAppState, SlideError, SlideMetadata, SlideService, slide_routes};
use serde::Serialize;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Create a test application router with state
pub fn create_test_app_with_state() -> (Router, AppState) {
    let app_state = AppState::new();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .layer(cors)
        .with_state(app_state.clone());

    (app, app_state)
}

/// Create a test application router with all routes configured
pub fn create_test_app() -> Router {
    create_test_app_with_state().0
}

/// Create a test slide info with standard values
pub fn create_test_slide_info() -> SlideInfo {
    SlideInfo {
        id: format!("test-slide-{}", &uuid::Uuid::new_v4().to_string()[..8]),
        name: "Test Slide".to_string(),
        width: 100000,
        height: 100000,
        tile_size: 256,
        num_levels: 10,
        tile_url_template: "/api/slide/{id}/tile/{level}/{x}/{y}".to_string(),
    }
}

/// Mock slide service for testing tile serving endpoints
pub struct MockSlideService {
    /// List of available slides
    slides: Vec<SlideMetadata>,
}

impl MockSlideService {
    pub fn new() -> Self {
        Self {
            slides: vec![SlideMetadata {
                id: "test-slide".to_string(),
                name: "Test Slide".to_string(),
                width: 10000,
                height: 10000,
                tile_size: 256,
                num_levels: 14, // ceil(log2(10000)) + 1 = 14
                format: "mock".to_string(),
                vendor: Some("mock".to_string()),
                mpp_x: Some(0.25),
                mpp_y: Some(0.25),
            }],
        }
    }
}

#[async_trait]
impl SlideService for MockSlideService {
    async fn list_slides(&self) -> Result<Vec<SlideMetadata>, SlideError> {
        Ok(self.slides.clone())
    }

    async fn get_slide(&self, id: &str) -> Result<SlideMetadata, SlideError> {
        self.slides
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| SlideError::NotFound(id.to_string()))
    }
}

/// Create a test application router with slide routes
pub fn create_test_app_with_slides() -> Router {
    let slide_state = SlideAppState {
        slide_service: Arc::new(MockSlideService::new()),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .nest("/api", slide_routes(slide_state))
        .layer(cors)
}

/// Create an AppState with a mock slide service for WebSocket tests
pub fn create_test_app_state_with_slides() -> AppState {
    let slide_service: Arc<dyn SlideService> = Arc::new(MockSlideService::new());
    AppState::new().with_slide_service(slide_service)
}
