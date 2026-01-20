//! Local overlay service implementation

use async_trait::async_trait;
use dashmap::DashMap;
use flate2::read::ZlibDecoder;
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::config::OverlayConfig;

use super::index::OverlaySpatialIndex;
use super::proto::SlideSegmentationData;
use super::reader::{AnnotationReader, CompositeReader};
use super::service::OverlayService;
use super::types::{
    CellMask, OverlayError, OverlayMetadata, RegionRequest, TissueClassInfo, TissueOverlayMetadata,
    TissueTileData, TissueTileInfo,
};

/// Cache state for overlay loading
#[derive(Clone)]
enum OverlayCacheState {
    /// File found, loading in progress
    Loading,
    /// Fully loaded and indexed
    Ready(Arc<CachedOverlay>),
}

/// Local overlay service that reads overlay files from disk
pub struct LocalOverlayService {
    overlays_dir: PathBuf,
    reader: CompositeReader,
    cache: Arc<DashMap<String, OverlayCacheState>>,
}

/// Cached overlay data including metadata and spatial index
struct CachedOverlay {
    metadata: OverlayMetadata,
    index: OverlaySpatialIndex,
    /// Raw protobuf data for tissue tile access
    raw_data: Arc<SlideSegmentationData>,
    /// Tile lookup map: (level, x, y) -> tile index
    tile_map: HashMap<(u32, u32, u32), usize>,
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
            cache: Arc::new(DashMap::new()),
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
        if let Some(entry) = self.cache.get(slide_id) {
            return match entry.value() {
                OverlayCacheState::Loading => {
                    // Still loading, return not found for now
                    Err(OverlayError::NotFound(slide_id.to_string()))
                }
                OverlayCacheState::Ready(cached) => Ok(cached.clone()),
            };
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

        // Build tile lookup map
        let tile_map = Self::build_tile_map(&data);

        let cached = Arc::new(CachedOverlay {
            metadata,
            index,
            raw_data: Arc::new(data),
            tile_map,
        });

        // Cache the overlay
        self.cache.insert(
            slide_id.to_string(),
            OverlayCacheState::Ready(cached.clone()),
        );

        info!(
            "Loaded overlay for slide '{}': {} cells",
            slide_id,
            cached.index.cell_count()
        );

        Ok(cached)
    }

    /// Check overlay status: (file_exists, is_ready)
    pub fn get_overlay_status(&self, slide_id: &str) -> (bool, bool) {
        // Check cache first
        if let Some(entry) = self.cache.get(slide_id) {
            return match entry.value() {
                OverlayCacheState::Loading => (true, false),
                OverlayCacheState::Ready(_) => (true, true),
            };
        }
        // Check if file exists (fast filesystem check)
        (self.find_overlay_file(slide_id).is_some(), false)
    }

    /// Initiate background loading for an overlay
    pub fn initiate_load(&self, slide_id: &str) {
        // Don't start if already loading/loaded
        if self.cache.contains_key(slide_id) {
            return;
        }

        // Check if file exists before marking as loading
        let path = match self.find_overlay_file(slide_id) {
            Some(p) => p,
            None => return,
        };

        // Mark as loading
        self.cache
            .insert(slide_id.to_string(), OverlayCacheState::Loading);

        // Clone what we need for the blocking task
        let cache = self.cache.clone();
        let slide_id = slide_id.to_string();
        let reader = CompositeReader::new();

        // Spawn blocking task for CPU-intensive work
        tokio::task::spawn_blocking(move || {
            match Self::do_load_blocking(&reader, &path, &slide_id) {
                Ok(cached) => {
                    cache.insert(slide_id.clone(), OverlayCacheState::Ready(cached.clone()));
                    info!(
                        "Background loaded overlay for slide '{}': {} cells",
                        slide_id,
                        cached.index.cell_count()
                    );
                }
                Err(e) => {
                    cache.remove(&slide_id); // Allow retry
                    warn!("Failed to load overlay for '{}': {}", slide_id, e);
                }
            }
        });
    }

    /// Perform blocking load of overlay file (runs on blocking thread pool)
    fn do_load_blocking(
        reader: &CompositeReader,
        path: &PathBuf,
        slide_id: &str,
    ) -> Result<Arc<CachedOverlay>, OverlayError> {
        debug!("Background loading overlay from: {:?}", path);

        // Read and parse file
        let data = reader.read(path)?;

        // Build spatial index
        let index = OverlaySpatialIndex::from_segmentation_data(&data);

        // Create metadata
        let metadata = Self::build_metadata(slide_id, &data, &index);

        // Build tile lookup map
        let tile_map = Self::build_tile_map(&data);

        Ok(Arc::new(CachedOverlay {
            metadata,
            index,
            raw_data: Arc::new(data),
            tile_map,
        }))
    }

    /// Build tile lookup map for O(1) tile access
    fn build_tile_map(data: &SlideSegmentationData) -> HashMap<(u32, u32, u32), usize> {
        let mut map = HashMap::new();
        for (idx, tile) in data.tiles.iter().enumerate() {
            let level = tile.level as u32;
            let x = tile.x as u32;
            let y = tile.y as u32;
            map.insert((level, x, y), idx);
        }
        map
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

    /// Get tissue overlay metadata including class mapping and tile grid
    pub fn get_tissue_metadata(
        &self,
        slide_id: &str,
    ) -> Result<TissueOverlayMetadata, OverlayError> {
        let cached = self.load_overlay(slide_id)?;
        let data = &cached.raw_data;

        // Check if we have tissue data (non-empty data bytes in first tile)
        let has_tissue_data = data
            .tiles
            .first()
            .map(|t| !t.tissue_segmentation_map.data.is_empty())
            .unwrap_or(false);

        if !has_tissue_data {
            return Err(OverlayError::NotFound(format!(
                "No tissue overlay data for slide '{}'",
                slide_id
            )));
        }

        // Build class mapping
        let mut classes: Vec<TissueClassInfo> = data
            .tissue_class_mapping
            .iter()
            .map(|(id, name)| TissueClassInfo {
                id: *id,
                name: name.clone(),
            })
            .collect();
        classes.sort_by_key(|c| c.id);

        // Build tile info list
        let tiles: Vec<TissueTileInfo> = data
            .tiles
            .iter()
            .filter(|t| !t.tissue_segmentation_map.data.is_empty())
            .map(|t| {
                let tissue_map = &t.tissue_segmentation_map;
                TissueTileInfo {
                    level: t.level as u32,
                    x: t.x as u32,
                    y: t.y as u32,
                    width: tissue_map.width as u32,
                    height: tissue_map.height as u32,
                }
            })
            .collect();

        // Determine tile size from first tile
        let tile_size = tiles.first().map(|t| t.width.max(t.height)).unwrap_or(256);

        Ok(TissueOverlayMetadata {
            slide_id: slide_id.to_string(),
            model_name: data.tissue_model_name.clone(),
            classes,
            tile_size,
            max_level: data.max_level as u32,
            tiles,
        })
    }

    /// Get raw tissue tile data (class indices per pixel)
    pub fn get_tissue_tile(
        &self,
        slide_id: &str,
        level: u32,
        x: u32,
        y: u32,
    ) -> Result<TissueTileData, OverlayError> {
        let cached = self.load_overlay(slide_id)?;

        // Look up tile by (level, x, y)
        let tile_idx = cached.tile_map.get(&(level, x, y)).ok_or_else(|| {
            OverlayError::NotFound(format!(
                "Tissue tile not found: level={}, x={}, y={}",
                level, x, y
            ))
        })?;

        let tile = &cached.raw_data.tiles[*tile_idx];
        let tissue_map = &tile.tissue_segmentation_map;

        if tissue_map.data.is_empty() {
            return Err(OverlayError::NotFound(format!(
                "No tissue data in tile: level={}, x={}, y={}",
                level, x, y
            )));
        }

        // Decompress the data if it's zlib compressed
        let decompressed_data = Self::decompress_tissue_data(
            &tissue_map.data,
            tissue_map.width as usize,
            tissue_map.height as usize,
        )?;

        Ok(TissueTileData {
            data: decompressed_data,
            width: tissue_map.width as u32,
            height: tissue_map.height as u32,
        })
    }

    /// Decompress zlib-compressed tissue data, or return as-is if not compressed
    fn decompress_tissue_data(
        data: &[u8],
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>, OverlayError> {
        let expected_size = width * height;

        // Check for zlib header (0x78 followed by 0x01, 0x5E, 0x9C, or 0xDA)
        if data.len() >= 2 && data[0] == 0x78 {
            // Looks like zlib compressed data, try to decompress
            let mut decoder = ZlibDecoder::new(data);
            let mut decompressed = Vec::with_capacity(expected_size);

            match decoder.read_to_end(&mut decompressed) {
                Ok(_) => {
                    if decompressed.len() != expected_size {
                        warn!(
                            "Decompressed size mismatch: expected {}, got {}",
                            expected_size,
                            decompressed.len()
                        );
                    }
                    Ok(decompressed)
                }
                Err(e) => {
                    // Decompression failed, might not actually be compressed
                    warn!("Zlib decompression failed, using raw data: {}", e);
                    Ok(data.to_vec())
                }
            }
        } else if data.len() == expected_size {
            // Data is already the expected size, use as-is
            Ok(data.to_vec())
        } else {
            // Size doesn't match and doesn't look compressed
            warn!(
                "Tissue data size {} doesn't match expected {} ({}x{})",
                data.len(),
                expected_size,
                width,
                height
            );
            Ok(data.to_vec())
        }
    }

    /// Check if tissue data is available for a slide
    pub fn has_tissue_data(&self, slide_id: &str) -> bool {
        if let Ok(cached) = self.load_overlay(slide_id) {
            return cached
                .raw_data
                .tiles
                .first()
                .map(|t| !t.tissue_segmentation_map.data.is_empty())
                .unwrap_or(false);
        }
        false
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

    async fn get_overlay_status(&self, slide_id: &str) -> (bool, bool) {
        // Delegate to the inherent method
        LocalOverlayService::get_overlay_status(self, slide_id)
    }

    async fn initiate_load(&self, slide_id: &str) {
        // Delegate to the inherent method
        LocalOverlayService::initiate_load(self, slide_id)
    }
}
