//! HTTP routes for overlay loading and serving
//!
//! Provides endpoints for:
//! - Loading overlay files from disk (server-side overlay_dir)
//! - Serving raster tiles (tissue heatmaps)
//! - Serving vector chunks (cell data)
//! - Getting overlay manifest

use crate::overlay::derive::{DerivePipeline, DerivedOverlay};
use crate::overlay::discovery::check_overlay_exists;
use crate::overlay::parser::OverlayParser;
use crate::server::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Slide-scoped overlay storage (keyed by slide_id for caching across sessions)
pub type OverlayStore = Arc<RwLock<HashMap<String, Arc<DerivedOverlay>>>>;

/// Create a new overlay store
pub fn new_overlay_store() -> OverlayStore {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Load request query parameters
#[derive(Debug, Deserialize)]
pub struct LoadQuery {
    /// Slide ID to load overlay for
    pub slide_id: String,
    /// Session ID for broadcasting overlay_loaded message
    pub session_id: String,
}

/// Load response
#[derive(Debug, Serialize)]
pub struct LoadResponse {
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

/// Load an overlay from the server-side overlay directory
///
/// POST /api/overlay/load?slide_id=<slide_id>&session_id=<session_id>
///
/// Loads the overlay file from: <overlay_dir>/<slide_id>/overlays.bin
/// If already cached, returns immediately with cached overlay.
pub async fn load_overlay(
    State(state): State<AppState>,
    Query(query): Query<LoadQuery>,
) -> Result<Json<LoadResponse>, ErrorResponse> {
    let slide_id = &query.slide_id;
    let session_id = &query.session_id;

    info!("Overlay load request for slide '{}' in session '{}'", slide_id, session_id);

    // Verify session exists
    if state.session_manager.get_session(session_id).await.is_err() {
        return Err(ErrorResponse {
            error: format!("Session not found: {}", session_id),
            code: "not_found".to_string(),
        });
    }

    // Use slide_id as the overlay_id for caching
    let overlay_id = slide_id.clone();

    // Check if overlay is already cached
    {
        let store = state.overlay_store.read().await;
        if let Some(overlay) = store.get(&overlay_id) {
            info!("Overlay '{}' already cached, returning immediately", overlay_id);

            let content_sha256 = overlay.content_sha256.clone();
            let total_raster_tiles = overlay.manifest.total_raster_tiles;
            let total_vector_chunks = overlay.manifest.total_vector_chunks;
            let manifest_tile_size = overlay.manifest.tile_size;
            let manifest_levels = overlay.manifest.levels;

            // Broadcast overlay_loaded to session (even if cached)
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
                            tile_size: manifest_tile_size,
                            levels: manifest_levels,
                        },
                    },
                )
                .await;

            return Ok(Json(LoadResponse {
                success: true,
                overlay_id,
                content_sha256,
                total_raster_tiles,
                total_vector_chunks,
                error: None,
            }));
        }
    }

    // Check if overlay file exists
    let overlay_info = match check_overlay_exists(&state.overlay_dir, slide_id) {
        Some(info) => info,
        None => {
            warn!("No overlay found for slide '{}' in {:?}", slide_id, state.overlay_dir);
            return Err(ErrorResponse {
                error: format!("No overlay found for slide: {}", slide_id),
                code: "not_found".to_string(),
            });
        }
    };

    info!(
        "Loading overlay for slide '{}' from {:?} ({} bytes)",
        slide_id, overlay_info.path, overlay_info.file_size
    );

    // Read overlay file
    let overlay_bytes = match std::fs::read(&overlay_info.path) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to read overlay file {:?}: {}", overlay_info.path, e);
            return Err(ErrorResponse {
                error: format!("Failed to read overlay file: {}", e),
                code: "io_error".to_string(),
            });
        }
    };

    // Parse the protobuf
    let parser = OverlayParser::new();
    let parsed = match parser.parse_bytes(&overlay_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse overlay for slide '{}': {}", slide_id, e);
            return Err(ErrorResponse {
                error: format!("Failed to parse overlay: {}", e),
                code: "bad_request".to_string(),
            });
        }
    };

    // Derive tiles and chunks
    let pipeline = DerivePipeline::default();
    let derived = pipeline.derive(parsed);

    let content_sha256 = derived.content_sha256.clone();
    let total_raster_tiles = derived.manifest.total_raster_tiles;
    let total_vector_chunks = derived.manifest.total_vector_chunks;
    let manifest_tile_size = derived.manifest.tile_size;
    let manifest_levels = derived.manifest.levels;

    // Store in slide-scoped storage (keyed by slide_id)
    {
        let mut store = state.overlay_store.write().await;
        store.insert(overlay_id.clone(), Arc::new(derived));
    }

    info!(
        "Overlay '{}' loaded: {} raster tiles, {} vector chunks",
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
                    tile_size: manifest_tile_size,
                    levels: manifest_levels,
                },
            },
        )
        .await;

    Ok(Json(LoadResponse {
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
    let tile = overlay
        .raster_tiles
        .get(&tile_key)
        .ok_or_else(|| ErrorResponse {
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
    let chunk = overlay
        .vector_chunks
        .get(&chunk_key)
        .ok_or_else(|| ErrorResponse {
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
    pub vertices: Vec<i32>,
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
        .map(|c| {
            // Compute centroid from bounding box
            let [min_x, min_y] = c.bbox.lower();
            let [max_x, max_y] = c.bbox.upper();
            ViewportCell {
                x: (min_x + max_x) / 2.0,
                y: (min_y + max_y) / 2.0,
                class_id: c.class_id,
                confidence: c.confidence,
            }
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
        .route("/load", post(load_overlay))
        .route("/:overlay_id/manifest", get(get_manifest))
        .route("/:overlay_id/raster/:level/:x/:y", get(get_raster_tile))
        .route("/:overlay_id/vec/:level/:x/:y", get(get_vector_chunk))
        .route("/:overlay_id/query", get(query_viewport))
}
