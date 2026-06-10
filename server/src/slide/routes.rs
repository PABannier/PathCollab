//! HTTP route handlers for slide API

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::service::SlideService;
use super::types::{SlideError, SlideListItem, SlideMetadata};

/// Application state containing the slide service
#[derive(Clone)]
pub struct SlideAppState {
    pub slide_service: Arc<dyn SlideService>,
}

/// Error response for slide API
#[derive(Debug, Serialize)]
pub struct SlideErrorResponse {
    pub error: String,
    pub code: String,
}

impl From<SlideError> for SlideErrorResponse {
    fn from(e: SlideError) -> Self {
        let code = match &e {
            SlideError::NotFound(_) => "not_found",
            SlideError::OpenError(_) => "open_error",
            SlideError::ServiceUnavailable(_) => "service_unavailable",
            SlideError::IoError(_) => "io_error",
        };
        Self {
            error: e.to_string(),
            code: code.to_string(),
        }
    }
}

impl IntoResponse for SlideErrorResponse {
    fn into_response(self) -> Response {
        let status = match self.code.as_str() {
            "not_found" => StatusCode::NOT_FOUND,
            "service_unavailable" => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self)).into_response()
    }
}

/// Response for GET /api/slides/default
#[derive(Debug, Serialize, Deserialize)]
pub struct DefaultSlideResponse {
    /// The slide ID to use
    pub slide_id: String,
    /// How this slide was selected: "first_available" or "last_used"
    pub source: String,
    /// Slide name
    pub name: String,
    /// Slide width in pixels
    pub width: u64,
    /// Slide height in pixels
    pub height: u64,
}

/// GET /api/slides - List all available slides
pub async fn list_slides(
    State(state): State<SlideAppState>,
) -> Result<Json<Vec<SlideListItem>>, SlideErrorResponse> {
    let slides = state.slide_service.list_slides().await.map_err(|e| {
        tracing::error!("Failed to list slides: {}", e);
        SlideErrorResponse::from(e)
    })?;

    Ok(Json(slides.into_iter().map(SlideListItem::from).collect()))
}

/// GET /api/slide/:id - Get metadata for a specific slide
pub async fn get_slide(
    State(state): State<SlideAppState>,
    Path(id): Path<String>,
) -> Result<Json<SlideMetadata>, SlideErrorResponse> {
    let metadata = state.slide_service.get_slide(&id).await.map_err(|e| {
        tracing::warn!("Failed to get slide {}: {}", id, e);
        SlideErrorResponse::from(e)
    })?;

    Ok(Json(metadata))
}

/// GET /api/slides/default - Get the default slide to display
///
/// Returns the first available slide from the slides directory.
/// Returns 404 if no slides are available.
pub async fn get_default_slide(
    State(state): State<SlideAppState>,
) -> Result<Json<DefaultSlideResponse>, SlideErrorResponse> {
    let slides = state.slide_service.list_slides().await.map_err(|e| {
        tracing::error!("Failed to list slides for default: {}", e);
        SlideErrorResponse::from(e)
    })?;

    if let Some(first) = slides.first() {
        tracing::info!("Default slide selected as first available: {}", first.id);
        return Ok(Json(DefaultSlideResponse {
            slide_id: first.id.clone(),
            source: "first_available".to_string(),
            name: first.name.clone(),
            width: first.width,
            height: first.height,
        }));
    }

    // No slides available
    Err(SlideErrorResponse {
        error: "No slides available. Place WSI files in the slides directory.".to_string(),
        code: "not_found".to_string(),
    })
}

/// Build slide API routes
pub fn slide_routes(state: SlideAppState) -> Router {
    Router::new()
        .route("/slides", get(list_slides))
        .route("/slides/default", get(get_default_slide))
        .route("/slide/:id", get(get_slide))
        .with_state(state)
}
