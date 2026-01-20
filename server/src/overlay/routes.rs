//! HTTP route handlers for overlay API

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::service::OverlayService;
use super::types::{
    CellsInRegionResponse, OverlayError, OverlayMetadata, RegionInfo, RegionRequest,
};

/// Application state containing the overlay service
#[derive(Clone)]
pub struct OverlayAppState {
    pub overlay_service: Arc<dyn OverlayService>,
}

/// Error response for overlay API
#[derive(Debug, Serialize)]
pub struct OverlayErrorResponse {
    pub error: String,
    pub code: String,
}

/// Loading response for overlay API (returned with 202 Accepted)
#[derive(Debug, Serialize)]
pub struct OverlayLoadingResponse {
    pub slide_id: String,
    pub status: String, // "loading"
}

impl From<OverlayError> for OverlayErrorResponse {
    fn from(e: OverlayError) -> Self {
        let code = match &e {
            OverlayError::NotFound(_) => "not_found",
            OverlayError::ParseError(_) => "parse_error",
            OverlayError::IoError(_) => "io_error",
            OverlayError::UnsupportedFormat(_) => "unsupported_format",
            OverlayError::RegionOutOfBounds { .. } => "region_out_of_bounds",
        };
        Self {
            error: e.to_string(),
            code: code.to_string(),
        }
    }
}

impl IntoResponse for OverlayErrorResponse {
    fn into_response(self) -> Response {
        let status = match self.code.as_str() {
            "not_found" => StatusCode::NOT_FOUND,
            "region_out_of_bounds" => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self)).into_response()
    }
}

/// Query parameters for region queries
#[derive(Debug, Deserialize)]
pub struct RegionQueryParams {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub level: Option<u32>,
}

/// GET /api/slide/:id/overlays - List available overlays for a slide
pub async fn list_overlays(
    State(state): State<OverlayAppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<OverlayMetadata>>, OverlayErrorResponse> {
    let overlays = state
        .overlay_service
        .list_overlays(&id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list overlays for slide {}: {}", id, e);
            OverlayErrorResponse::from(e)
        })?;

    Ok(Json(overlays))
}

/// GET /api/slide/:id/overlay/cells - Get cells within a region
pub async fn get_cells_in_region(
    State(state): State<OverlayAppState>,
    Path(id): Path<String>,
    Query(params): Query<RegionQueryParams>,
) -> Result<Json<CellsInRegionResponse>, OverlayErrorResponse> {
    let request = RegionRequest {
        slide_id: id.clone(),
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        level: params.level,
    };

    let cells = state
        .overlay_service
        .get_cells_in_region(&request)
        .await
        .map_err(|e| {
            tracing::warn!("Failed to get cells in region for slide {}: {}", id, e);
            OverlayErrorResponse::from(e)
        })?;

    let total_count = cells.len();

    tracing::debug!(
        "Querying cells in region: ({}, {}) {}x{} - found {} cells",
        params.x,
        params.y,
        params.width,
        params.height,
        total_count
    );

    Ok(Json(CellsInRegionResponse {
        cells,
        total_count,
        region: RegionInfo {
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
        },
    }))
}

/// GET /api/slide/:id/overlay/metadata - Get overlay metadata
pub async fn get_overlay_metadata(
    State(state): State<OverlayAppState>,
    Path(id): Path<String>,
) -> Response {
    let (exists, ready) = state.overlay_service.get_overlay_status(&id).await;

    if !exists {
        return (
            StatusCode::NOT_FOUND,
            Json(OverlayErrorResponse {
                error: format!("No overlay found for slide '{}'", id),
                code: "not_found".to_string(),
            }),
        )
            .into_response();
    }

    if !ready {
        // Initiate loading if not already started
        state.overlay_service.initiate_load(&id).await;
        // Return 202 Accepted
        return (
            StatusCode::ACCEPTED,
            Json(OverlayLoadingResponse {
                slide_id: id,
                status: "loading".to_string(),
            }),
        )
            .into_response();
    }

    // Ready - return full metadata (200 OK)
    match state.overlay_service.get_overlay_metadata(&id).await {
        Ok(metadata) => (StatusCode::OK, Json(metadata)).into_response(),
        Err(e) => {
            tracing::warn!("Failed to get overlay metadata for slide {}: {}", id, e);
            OverlayErrorResponse::from(e).into_response()
        }
    }
}

/// Build overlay API routes
pub fn overlay_routes(state: OverlayAppState) -> Router {
    Router::new()
        .route("/slide/:id/overlays", get(list_overlays))
        .route("/slide/:id/overlay/cells", get(get_cells_in_region))
        .route("/slide/:id/overlay/metadata", get(get_overlay_metadata))
        .with_state(state)
}
