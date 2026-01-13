//! Common Test Utilities for Integration Tests
//!
//! Shared helpers used across integration test modules.

use axum::{Json, Router, routing::get};
use pathcollab_server::overlay::overlay_routes;
use pathcollab_server::protocol::SlideInfo;
use pathcollab_server::server::AppState;
use serde::Serialize;
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

/// Create a test application router with all routes configured
pub fn create_test_app() -> Router {
    let app_state = AppState::new();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .nest("/api/overlay", overlay_routes())
        .layer(cors)
        .with_state(app_state)
}

/// Create a test slide info with standard values
pub fn create_test_slide_info() -> SlideInfo {
    SlideInfo {
        id: format!("test-slide-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
        name: "Test Slide".to_string(),
        width: 100000,
        height: 100000,
        tile_size: 256,
        num_levels: 10,
        tile_url_template: "/api/slide/{id}/tile/{level}/{x}/{y}".to_string(),
    }
}

/// Initialize test logging for detailed output
pub fn init_test_logging() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pathcollab=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_test_writer())
        .try_init();
}
