//! Common Test Utilities for Integration Tests
//!
//! Shared helpers used across integration test modules.

use async_trait::async_trait;
use axum::{Json, Router, routing::get};
use pathcollab_server::overlay::overlay_routes;
use pathcollab_server::protocol::SlideInfo;
use pathcollab_server::server::AppState;
use pathcollab_server::{
    SlideAppState, SlideError, SlideMetadata, SlideService, TileRequest, slide_routes,
};
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
        .nest("/api/overlay", overlay_routes())
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
        has_overlay: false,
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
                has_overlay: false,
            }],
        }
    }

    /// Create a minimal test JPEG (1x1 red pixel)
    fn create_test_jpeg() -> Vec<u8> {
        // Minimal valid JPEG for a 1x1 red pixel
        vec![
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
            0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06,
            0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D,
            0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D,
            0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28,
            0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01,
            0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
            0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
            0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10,
            0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00,
            0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42,
            0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16,
            0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
            0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
            0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73,
            0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
            0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA,
            0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6,
            0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
            0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08,
            0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9,
        ]
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

    async fn get_tile(&self, request: &TileRequest) -> Result<Vec<u8>, SlideError> {
        // Verify slide exists
        let metadata = self.get_slide(&request.slide_id).await?;

        // Validate level
        if request.level >= metadata.num_levels {
            return Err(SlideError::InvalidLevel(request.level));
        }

        // Calculate dimensions at this level
        let dzi_max_level = metadata.num_levels - 1;
        let levels_from_max = dzi_max_level - request.level;
        let dzi_scale = 2.0_f64.powi(levels_from_max as i32);
        let level_width = (metadata.width as f64 / dzi_scale).ceil() as u32;
        let level_height = (metadata.height as f64 / dzi_scale).ceil() as u32;

        // Validate tile coordinates
        let tile_x_start = request.x * metadata.tile_size;
        let tile_y_start = request.y * metadata.tile_size;

        if tile_x_start >= level_width || tile_y_start >= level_height {
            return Err(SlideError::InvalidTileCoordinates {
                level: request.level,
                x: request.x,
                y: request.y,
            });
        }

        // Return a test JPEG
        Ok(Self::create_test_jpeg())
    }
}

/// Create a test application router with slide routes
pub fn create_test_app_with_slides() -> Router {
    let slide_state = SlideAppState {
        slide_service: Arc::new(MockSlideService::new()),
        overlay_dir: std::path::PathBuf::from("./test_overlays"),
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

/// Initialize test logging for detailed output
#[allow(dead_code)]
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
