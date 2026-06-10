//! Fovea rendering-data forwarder.
//!
//! PathCollab does not tile or render slides itself. It forwards
//! `/api/fovea/:id/*` to fovea-pack's router, which serves the slide tile
//! pyramid, cell chunks, and density heatmap directly from a WSI + an overlay
//! protobuf. This module owns only:
//!   1. resolving a slide id to its WSI path + (optional) overlay protobuf path, and
//!   2. the per-slide lifecycle: lazily preparing `SlideSources` once (deduped
//!      across concurrent requests) and caching them.
//!
//! All tiling, manifest building, cell-chunk encoding, heatmap building, path
//! parsing, and tile caching live in fovea-pack — never duplicated here.

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use dashmap::DashMap;
use fovea_pack::{ImageFormat, SlideSources, SourceOptions, prepare_sources, route_request};
use tokio::sync::OnceCell;
use tracing::{info, warn};

use crate::config::{FoveaConfig, OverlayConfig, SlideConfig};

/// Slide file extensions OpenSlide (via fovea-pack) can read.
const SLIDE_EXTENSIONS: &[&str] = &["svs", "ndpi", "tiff", "tif", "vms", "vmu", "scn", "mrxs"];

/// Per-slide preparation slot. A `OnceCell` dedups concurrent first requests
/// (slide + cells + heatmap manifests arrive together): preparation runs once
/// via `get_or_try_init`, and a failed attempt leaves the cell uninitialized so
/// a later request retries.
type SourceSlot = Arc<OnceCell<Arc<SlideSources>>>;

#[derive(Clone)]
pub struct FoveaAppState {
    inner: Arc<FoveaInner>,
}

struct FoveaInner {
    slides_dir: PathBuf,
    overlays_dir: PathBuf,
    config: FoveaConfig,
    sources: DashMap<String, SourceSlot>,
}

enum Prepared {
    Ready(Arc<SlideSources>),
    NotFound,
    Failed(String),
}

impl FoveaAppState {
    pub fn new(slide: &SlideConfig, overlay: &OverlayConfig, config: FoveaConfig) -> Self {
        Self {
            inner: Arc::new(FoveaInner {
                slides_dir: slide.slides_dir.clone(),
                overlays_dir: overlay.overlays_dir.clone(),
                config,
                sources: DashMap::new(),
            }),
        }
    }

    /// Resolve a slide id to its WSI path by scanning the slides directory.
    fn find_slide_path(&self, id: &str) -> Option<PathBuf> {
        let entries = std::fs::read_dir(&self.inner.slides_dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            let Some(ext) = ext else { continue };
            if !SLIDE_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let stem = path.file_stem().and_then(|s| s.to_str()).map(sanitize_id);
            if stem.as_deref() == Some(id) {
                return Some(path);
            }
        }
        None
    }

    /// Resolve a slide's overlay protobuf path, if one exists. Supports several
    /// on-disk layouts:
    ///   - `{overlays_dir}/{id}.bin` / `{id}.pb`
    ///   - `{overlays_dir}/{id}/cell_masks.bin` / `cell_masks.pb`
    ///   - `{overlays_dir}/{wsi_file_name}/cell_masks.bin` (subdir named after the
    ///     full slide filename, e.g. `TCGA-….svs/cell_masks.bin`)
    fn find_overlay_path(&self, id: &str, wsi_path: &std::path::Path) -> Option<PathBuf> {
        for ext in &["bin", "pb"] {
            let path = self.inner.overlays_dir.join(format!("{id}.{ext}"));
            if path.exists() {
                return Some(path);
            }
        }

        // Candidate subdirectory names: the sanitized id and the raw slide filename.
        let mut subdirs: Vec<String> = vec![id.to_string()];
        if let Some(name) = wsi_path.file_name().and_then(|n| n.to_str()) {
            subdirs.push(name.to_string());
        }
        for subdir in subdirs {
            for filename in &["cell_masks.bin", "cell_masks.pb"] {
                let path = self.inner.overlays_dir.join(&subdir).join(filename);
                if path.exists() {
                    return Some(path);
                }
            }
        }
        None
    }

    fn source_options(&self, id: &str) -> Option<SourceOptions> {
        let wsi_path = self.find_slide_path(id)?;
        let cells_protobuf_path = self.find_overlay_path(id, &wsi_path);
        let c = &self.inner.config;
        // Only build a heatmap when cells exist to derive it from.
        let heatmap = c.heatmap && cells_protobuf_path.is_some();
        Some(SourceOptions {
            wsi_path,
            cells_protobuf_path,
            tile_size: c.tile_size,
            image_format: ImageFormat::Jpeg,
            chunk_size: c.chunk_size,
            max_vertices_per_cell: c.max_vertices_per_cell,
            heatmap,
            heatmap_bin_size: c.heatmap_bin_size,
            heatmap_tile_size: c.heatmap_tile_size,
            tile_cache_mb: c.tile_cache_mb,
        })
    }

    /// Get prepared sources for a slide, preparing them once on first use.
    /// Blocks (awaits) until preparation completes; subsequent calls are instant.
    async fn prepare(&self, id: &str) -> Prepared {
        let Some(options) = self.source_options(id) else {
            return Prepared::NotFound;
        };

        let slot = self
            .inner
            .sources
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone();

        info!("fovea: preparing/serving sources for slide {id}");
        let result = slot
            .get_or_try_init(|| async move {
                prepare_sources(options)
                    .await
                    .map(Arc::new)
                    .map_err(|err| format!("{err:#}"))
            })
            .await;

        match result {
            Ok(sources) => Prepared::Ready(Arc::clone(sources)),
            Err(err) => Prepared::Failed(err),
        }
    }
}

/// Build the fovea forwarding routes. Mounted under `/api`, so the public paths
/// are `/api/fovea/:id/slide/manifest.json`, `/api/fovea/:id/slide/images/...`,
/// `/api/fovea/:id/cells/manifest.json`, `/api/fovea/:id/heatmap/...`, etc.
pub fn fovea_routes(state: FoveaAppState) -> Router {
    Router::new()
        .route("/fovea/:id/*rest", get(handle_fovea))
        .with_state(state)
}

async fn handle_fovea(
    State(state): State<FoveaAppState>,
    Path((id, rest)): Path<(String, String)>,
) -> Response {
    match state.prepare(&id).await {
        Prepared::Ready(sources) => {
            // `rest` is the slide-relative path fovea-pack expects, e.g.
            // "slide/images/level_0/0_0.jpg" -> "/slide/images/level_0/0_0.jpg".
            let path = format!("/{rest}");
            match route_request(&sources, &path).await {
                Ok(response) => response,
                Err(err) => {
                    warn!("fovea: route_request failed for {id} {path}: {err:#}");
                    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
                }
            }
        }
        Prepared::NotFound => (StatusCode::NOT_FOUND, "slide not found").into_response(),
        Prepared::Failed(err) => {
            warn!("fovea: preparation failed for {id}: {err}");
            (StatusCode::INTERNAL_SERVER_ERROR, err).into_response()
        }
    }
}

/// Sanitize a filename stem into a slide id (mirrors the slide catalog so ids
/// resolve consistently between `/api/slides` and `/api/fovea/:id`).
fn sanitize_id(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
