//! HTTP routes for overlay upload and serving
//!
//! Provides endpoints for:
//! - Uploading overlay protobuf files
//! - Serving raster tiles (tissue heatmaps)
//! - Serving vector chunks (cell data)
//! - Getting overlay manifest

use crate::overlay::derive::{DerivePipeline, DerivedOverlay};
use crate::overlay::parser::OverlayParser;
use crate::server::AppState;
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

/// Session-scoped overlay storage
pub type OverlayStore = Arc<RwLock<HashMap<String, Arc<DerivedOverlay>>>>;

/// Create a new overlay store
pub fn new_overlay_store() -> OverlayStore {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Upload request query parameters
#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    /// Session ID to associate overlay with
    pub session_id: String,
}

/// Upload response
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub success: bool,
    pub overlay_id: String,
    pub content_sha256: String,
    pub total_raster_tiles: usize,
    pub total_vector_chunks: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Manifest response
#[derive(Debug, Serialize)]
pub struct ManifestResponse {
    pub overlay_id: String,
    pub content_sha256: String,
    pub tile_size: u32,
    pub levels: u32,
    pub raster_base_url: String,
    pub vec_base_url: String,
    pub total_raster_tiles: usize,
    pub total_vector_chunks: usize,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        let status = match self.code.as_str() {
            "not_found" => StatusCode::NOT_FOUND,
            "bad_request" => StatusCode::BAD_REQUEST,
            "payload_too_large" => StatusCode::PAYLOAD_TOO_LARGE,
            "unauthorized" => StatusCode::UNAUTHORIZED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self)).into_response()
    }
}

/// Upload an overlay protobuf file
///
/// POST /api/overlay/upload?session_id=<session_id>
/// Content-Type: application/octet-stream
/// Body: protobuf bytes
pub async fn upload_overlay(
    State(state): State<AppState>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<UploadResponse>, ErrorResponse> {
    let session_id = &query.session_id;

    info!(
        "Overlay upload request for session {}: {} bytes",
        session_id,
        body.len()
    );

    // Verify session exists
    if state.session_manager.get_session(session_id).await.is_err() {
        return Err(ErrorResponse {
            error: format!("Session not found: {}", session_id),
            code: "not_found".to_string(),
        });
    }

    // Parse the protobuf
    let parser = OverlayParser::new();
    let parsed = match parser.parse_bytes(&body) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse overlay: {}", e);
            return Err(ErrorResponse {
                error: format!("Failed to parse overlay: {}", e),
                code: "bad_request".to_string(),
            });
        }
    };

    // Derive tiles and chunks
    let pipeline = DerivePipeline::default();
    let derived = pipeline.derive(parsed);

    let overlay_id = format!("{}_{}", session_id, &derived.content_sha256[..8]);
    let content_sha256 = derived.content_sha256.clone();
    let total_raster_tiles = derived.manifest.total_raster_tiles;
    let total_vector_chunks = derived.manifest.total_vector_chunks;

    // Store in session-scoped storage
    {
        let mut store = state.overlay_store.write().await;
        store.insert(overlay_id.clone(), Arc::new(derived));
    }

    info!(
        "Overlay {} uploaded: {} raster tiles, {} vector chunks",
        overlay_id, total_raster_tiles, total_vector_chunks
    );

    // Broadcast overlay_loaded to session
    state
        .broadcast_to_session(
            session_id,
            crate::protocol::ServerMessage::OverlayLoaded {
                overlay_id: overlay_id.clone(),
                manifest: crate::protocol::OverlayManifest {
                    overlay_id: overlay_id.clone(),
                    content_sha256: content_sha256.clone(),
                    raster_base_url: format!("/api/overlay/{}/raster", overlay_id),
                    vec_base_url: format!("/api/overlay/{}/vec", overlay_id),
                    tile_size: 256,
                    levels: 10,
                },
            },
        )
        .await;

    Ok(Json(UploadResponse {
        success: true,
        overlay_id,
        content_sha256,
        total_raster_tiles,
        total_vector_chunks,
        error: None,
    }))
}

/// Get overlay manifest
///
/// GET /api/overlay/:overlay_id/manifest
pub async fn get_manifest(
    State(state): State<AppState>,
    Path(overlay_id): Path<String>,
) -> Result<Json<ManifestResponse>, ErrorResponse> {
    let store = state.overlay_store.read().await;
    let overlay = store.get(&overlay_id).ok_or_else(|| ErrorResponse {
        error: format!("Overlay not found: {}", overlay_id),
        code: "not_found".to_string(),
    })?;

    Ok(Json(ManifestResponse {
        overlay_id: overlay_id.clone(),
        content_sha256: overlay.content_sha256.clone(),
        tile_size: overlay.manifest.tile_size,
        levels: overlay.manifest.levels,
        raster_base_url: format!("/api/overlay/{}/raster", overlay_id),
        vec_base_url: format!("/api/overlay/{}/vec", overlay_id),
        total_raster_tiles: overlay.manifest.total_raster_tiles,
        total_vector_chunks: overlay.manifest.total_vector_chunks,
    }))
}

/// Tile path parameters
#[derive(Debug, Deserialize)]
pub struct TilePath {
    pub overlay_id: String,
    pub level: u32,
    pub x: u32,
    pub y: u32,
}

/// Get a raster tile (tissue heatmap)
///
/// GET /api/overlay/:overlay_id/raster/:level/:x/:y
pub async fn get_raster_tile(
    State(state): State<AppState>,
    Path(path): Path<TilePath>,
) -> Result<Response, ErrorResponse> {
    let store = state.overlay_store.read().await;
    let overlay = store.get(&path.overlay_id).ok_or_else(|| ErrorResponse {
        error: format!("Overlay not found: {}", path.overlay_id),
        code: "not_found".to_string(),
    })?;

    let tile_key = (path.level, path.x, path.y);
    let tile = overlay.raster_tiles.get(&tile_key).ok_or_else(|| ErrorResponse {
        error: format!(
            "Tile not found: level={}, x={}, y={}",
            path.level, path.x, path.y
        ),
        code: "not_found".to_string(),
    })?;

    // Return RGBA as raw bytes (could be WebP in production)
    // For now, return as PNG-compatible raw RGBA
    Ok((
        StatusCode::OK,
        [
            ("Content-Type", "application/octet-stream"),
            ("X-Tile-Width", "256"),
            ("X-Tile-Height", "256"),
            ("X-Tile-Format", "rgba"),
        ],
        tile.rgba_data.clone(),
    )
        .into_response())
}

/// Get a vector chunk (cell data)
///
/// GET /api/overlay/:overlay_id/vec/:level/:x/:y
pub async fn get_vector_chunk(
    State(state): State<AppState>,
    Path(path): Path<TilePath>,
) -> Result<Json<VectorChunkResponse>, ErrorResponse> {
    let store = state.overlay_store.read().await;
    let overlay = store.get(&path.overlay_id).ok_or_else(|| ErrorResponse {
        error: format!("Overlay not found: {}", path.overlay_id),
        code: "not_found".to_string(),
    })?;

    let chunk_key = (path.level, path.x, path.y);
    let chunk = overlay.vector_chunks.get(&chunk_key).ok_or_else(|| ErrorResponse {
        error: format!(
            "Chunk not found: level={}, x={}, y={}",
            path.level, path.x, path.y
        ),
        code: "not_found".to_string(),
    })?;

    // Convert to response format
    let cells: Vec<CellResponse> = chunk
        .cells
        .iter()
        .map(|c| CellResponse {
            class_id: c.class_id,
            confidence: c.confidence,
            x: c.centroid_x,
            y: c.centroid_y,
            vertices: c.vertices.clone(),
        })
        .collect();

    Ok(Json(VectorChunkResponse {
        level: path.level,
        x: path.x,
        y: path.y,
        cell_count: cells.len(),
        cells,
    }))
}

/// Vector chunk response
#[derive(Debug, Serialize)]
pub struct VectorChunkResponse {
    pub level: u32,
    pub x: u32,
    pub y: u32,
    pub cell_count: usize,
    pub cells: Vec<CellResponse>,
}

/// Cell data in response
#[derive(Debug, Serialize)]
pub struct CellResponse {
    pub class_id: u8,
    pub confidence: u8,
    pub x: i16,
    pub y: i16,
    pub vertices: Vec<i16>,
}

/// Query cells in a viewport region
#[derive(Debug, Deserialize)]
pub struct ViewportQuery {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    10000
}

/// Query cells in viewport
///
/// GET /api/overlay/:overlay_id/query?min_x=...&min_y=...&max_x=...&max_y=...&limit=...
pub async fn query_viewport(
    State(state): State<AppState>,
    Path(overlay_id): Path<String>,
    Query(query): Query<ViewportQuery>,
) -> Result<Json<ViewportQueryResponse>, ErrorResponse> {
    let store = state.overlay_store.read().await;
    let overlay = store.get(&overlay_id).ok_or_else(|| ErrorResponse {
        error: format!("Overlay not found: {}", overlay_id),
        code: "not_found".to_string(),
    })?;

    let cells = overlay.index.query_viewport_limited(
        query.min_x,
        query.min_y,
        query.max_x,
        query.max_y,
        query.limit,
    );

    let results: Vec<ViewportCell> = cells
        .into_iter()
        .map(|c| ViewportCell {
            x: c.centroid_x,
            y: c.centroid_y,
            class_id: c.class_id,
            confidence: c.confidence,
        })
        .collect();

    Ok(Json(ViewportQueryResponse {
        count: results.len(),
        cells: results,
    }))
}

/// Viewport query response
#[derive(Debug, Serialize)]
pub struct ViewportQueryResponse {
    pub count: usize,
    pub cells: Vec<ViewportCell>,
}

/// Cell in viewport response
#[derive(Debug, Serialize)]
pub struct ViewportCell {
    pub x: f32,
    pub y: f32,
    pub class_id: u32,
    pub confidence: f32,
}

/// Build overlay API routes
pub fn overlay_routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};

    axum::Router::new()
        .route("/upload", post(upload_overlay))
        .route("/:overlay_id/manifest", get(get_manifest))
        .route("/:overlay_id/raster/:level/:x/:y", get(get_raster_tile))
        .route("/:overlay_id/vec/:level/:x/:y", get(get_vector_chunk))
        .route("/:overlay_id/query", get(query_viewport))
}
