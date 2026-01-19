//! HTTP route handlers for slide API

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::service::SlideService;
use super::types::{SlideError, SlideListItem, SlideMetadata, TileRequest};

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
            SlideError::TileError(_) => "tile_error",
            SlideError::InvalidLevel(_) => "invalid_level",
            SlideError::InvalidTileCoordinates { .. } => "invalid_coordinates",
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
            "invalid_level" | "invalid_coordinates" => StatusCode::BAD_REQUEST,
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

/// GET /api/slide/:id/dzi - Get DZI XML descriptor for OpenSeadragon
pub async fn get_dzi_descriptor(
    State(state): State<SlideAppState>,
    Path(id): Path<String>,
) -> Result<Response, SlideErrorResponse> {
    let metadata = state.slide_service.get_slide(&id).await.map_err(|e| {
        tracing::warn!("Failed to get slide {} for DZI: {}", id, e);
        SlideErrorResponse::from(e)
    })?;

    // Generate DZI XML descriptor
    // DZI format: https://docs.microsoft.com/en-us/previous-versions/windows/silverlight/dotnet-windows-silverlight/cc645077(v=vs.95)
    let dzi_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
       Format="jpeg"
       Overlap="0"
       TileSize="{}">
    <Size Width="{}" Height="{}"/>
</Image>"#,
        metadata.tile_size, metadata.width, metadata.height
    );

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/xml"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        dzi_xml,
    )
        .into_response())
}

/// GET /api/slide/:id/tile/:level/:x/:y - Get a tile as JPEG
pub async fn get_tile(
    State(state): State<SlideAppState>,
    Path((id, level, x, y)): Path<(String, u32, u32, u32)>,
) -> Result<Response, SlideErrorResponse> {
    let request = TileRequest {
        slide_id: id.clone(),
        level,
        x,
        y,
    };

    let jpeg_bytes = state.slide_service.get_tile(&request).await.map_err(|e| {
        // Only log as error if it's not a simple "not found" or "invalid coords"
        match &e {
            SlideError::NotFound(_) | SlideError::InvalidTileCoordinates { .. } => {
                tracing::debug!("Tile not found: {} level={} x={} y={}", id, level, x, y);
            }
            _ => {
                tracing::error!(
                    "Failed to get tile: {} level={} x={} y={}: {}",
                    id,
                    level,
                    x,
                    y,
                    e
                );
            }
        }
        SlideErrorResponse::from(e)
    })?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        jpeg_bytes,
    )
        .into_response())
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
        .route("/slide/:id/dzi", get(get_dzi_descriptor))
        .route("/slide/:id/tile/:level/:x/:y", get(get_tile))
        .with_state(state)
}
