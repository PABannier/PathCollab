//! Local overlay service implementation

use async_trait::async_trait;
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::config::OverlayConfig;

use super::index::OverlaySpatialIndex;
use super::proto::SlideSegmentationData;
use super::reader::{AnnotationReader, CompositeReader};
use super::service::OverlayService;
use super::types::{CellMask, OverlayError, OverlayMetadata, RegionRequest};

/// Local overlay service that reads overlay files from disk
pub struct LocalOverlayService {
    overlays_dir: PathBuf,
    reader: CompositeReader,
    /// Cache: slide_id -> (metadata, spatial index)
    cache: DashMap<String, Arc<CachedOverlay>>,
}

/// Cached overlay data including metadata and spatial index
struct CachedOverlay {
    metadata: OverlayMetadata,
    index: OverlaySpatialIndex,
}

impl LocalOverlayService {
    /// Create a new LocalOverlayService
    pub fn new(config: &OverlayConfig) -> Result<Self, OverlayError> {
        let overlays_dir = config.overlays_dir.clone();

        // Create directory if it doesn't exist
        if !overlays_dir.exists() {
            std::fs::create_dir_all(&overlays_dir)?;
            info!("Created overlays directory: {:?}", overlays_dir);
        }

        Ok(Self {
            overlays_dir,
            reader: CompositeReader::new(),
            cache: DashMap::new(),
        })
    }

    /// Find overlay file for a given slide ID
    fn find_overlay_file(&self, slide_id: &str) -> Option<PathBuf> {
        // Try common extensions directly in overlays dir
        for ext in &["bin", "pb"] {
            let path = self.overlays_dir.join(format!("{}.{}", slide_id, ext));
            if path.exists() {
                return Some(path);
            }
        }

        // Try subdirectory structure: {slide_id}/cell_masks.bin
        for filename in &["cell_masks.bin", "cell_masks.pb"] {
            let path = self.overlays_dir.join(slide_id).join(filename);
            if path.exists() {
                return Some(path);
            }
        }

        None
    }

    /// Load and cache overlay data for a slide
    fn load_overlay(&self, slide_id: &str) -> Result<Arc<CachedOverlay>, OverlayError> {
        // Check cache first
        if let Some(cached) = self.cache.get(slide_id) {
            return Ok(cached.clone());
        }

        // Find overlay file
        let path = self
            .find_overlay_file(slide_id)
            .ok_or_else(|| OverlayError::NotFound(slide_id.to_string()))?;

        debug!("Loading overlay from: {:?}", path);

        // Read and parse file
        let data = self.reader.read(&path)?;

        // Build spatial index
        let index = OverlaySpatialIndex::from_segmentation_data(&data);

        // Create metadata
        let metadata = Self::build_metadata(slide_id, &data, &index);

        let cached = Arc::new(CachedOverlay { metadata, index });

        // Cache the overlay
        self.cache.insert(slide_id.to_string(), cached.clone());

        info!(
            "Loaded overlay for slide '{}': {} cells",
            slide_id,
            cached.index.cell_count()
        );

        Ok(cached)
    }

    /// Build metadata from segmentation data
    fn build_metadata(
        slide_id: &str,
        data: &SlideSegmentationData,
        index: &OverlaySpatialIndex,
    ) -> OverlayMetadata {
        OverlayMetadata {
            id: format!("{}_overlay", slide_id),
            slide_id: slide_id.to_string(),
            mpp: data.mpp,
            cell_count: index.cell_count(),
            cell_types: index.cell_types(),
            cell_model_name: data.cell_model_name.clone(),
            tissue_model_name: data.tissue_model_name.clone(),
        }
    }

    /// List all available overlay files
    fn list_overlay_files(&self) -> Vec<String> {
        let mut slide_ids = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&self.overlays_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                // Check for direct files like {slide_id}.bin
                if self.reader.can_read(&path)
                    && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
                {
                    slide_ids.push(stem.to_string());
                }

                // Check for subdirectories with cell_masks.bin inside
                if path.is_dir() {
                    for filename in &["cell_masks.bin", "cell_masks.pb"] {
                        let overlay_path = path.join(filename);
                        if overlay_path.exists()
                            && let Some(dir_name) = path.file_name().and_then(|s| s.to_str())
                        {
                            slide_ids.push(dir_name.to_string());
                            break;
                        }
                    }
                }
            }
        }

        slide_ids.sort();
        slide_ids.dedup();
        slide_ids
    }
}

#[async_trait]
impl OverlayService for LocalOverlayService {
    async fn list_overlays(&self, slide_id: &str) -> Result<Vec<OverlayMetadata>, OverlayError> {
        // If a specific slide_id is provided, check if overlay exists for it
        if !slide_id.is_empty() {
            match self.load_overlay(slide_id) {
                Ok(cached) => return Ok(vec![cached.metadata.clone()]),
                Err(OverlayError::NotFound(_)) => return Ok(vec![]),
                Err(e) => return Err(e),
            }
        }

        // Otherwise, list all available overlays
        let slide_ids = self.list_overlay_files();
        let mut overlays = Vec::new();

        for id in slide_ids {
            match self.load_overlay(&id) {
                Ok(cached) => overlays.push(cached.metadata.clone()),
                Err(e) => {
                    warn!("Failed to load overlay for '{}': {}", id, e);
                }
            }
        }

        Ok(overlays)
    }

    async fn get_cells_in_region(
        &self,
        request: &RegionRequest,
    ) -> Result<Vec<CellMask>, OverlayError> {
        let cached = self.load_overlay(&request.slide_id)?;

        let cells = cached
            .index
            .query_region(request.x, request.y, request.width, request.height);

        Ok(cells.into_iter().cloned().collect())
    }

    async fn get_overlay_metadata(&self, slide_id: &str) -> Result<OverlayMetadata, OverlayError> {
        let cached = self.load_overlay(slide_id)?;
        Ok(cached.metadata.clone())
    }
}
