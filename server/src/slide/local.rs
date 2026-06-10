//! Local slide service using OpenSlide

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use openslide_rs::OpenSlide;
use tracing::{debug, error, info, warn};

use crate::config::SlideConfig;

use super::cache::SlideCache;
use super::service::SlideService;
use super::types::{SlideError, SlideMetadata};

/// Supported slide file extensions
const SLIDE_EXTENSIONS: &[&str] = &["svs", "ndpi", "tiff", "tif", "vms", "vmu", "scn", "mrxs"];

/// Local slide catalog using OpenSlide for metadata. Rendering tiles are served
/// by the fovea forwarder, not here.
pub struct LocalSlideService {
    slides_dir: PathBuf,
    cache: SlideCache,
    tile_size: u32,
}

impl LocalSlideService {
    /// Create a new local slide service
    pub fn new(config: &SlideConfig) -> Result<Self, SlideError> {
        let slides_dir = &config.slides_dir;

        if !slides_dir.exists() {
            return Err(SlideError::IoError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Slides directory not found: {:?}", slides_dir),
            )));
        }

        if !slides_dir.is_dir() {
            return Err(SlideError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Slides path is not a directory: {:?}", slides_dir),
            )));
        }

        info!(
            "Initialized local slide catalog with directory: {:?}",
            slides_dir
        );

        Ok(Self {
            slides_dir: slides_dir.clone(),
            cache: SlideCache::new(config.max_cached_slides),
            tile_size: config.tile_size,
        })
    }

    /// Scan the slides directory for slide files
    async fn scan_slides_cached(&self) -> Vec<(String, PathBuf)> {
        // Check if we have a valid cached list
        if let Some(cached) = self.cache.get_slide_list().await {
            return cached;
        }

        // Scan directory and cache the result
        let slides = self.scan_slides_inner();
        self.cache.set_slide_list(slides.clone()).await;
        slides
    }

    /// Scan the slides directory for slide files (internal, synchronous)
    fn scan_slides_inner(&self) -> Vec<(String, PathBuf)> {
        let mut slides = Vec::new();

        let entries = match std::fs::read_dir(&self.slides_dir) {
            Ok(entries) => entries,
            Err(e) => {
                error!("Failed to read slides directory: {}", e);
                return slides;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());

            #[allow(clippy::collapsible_if)]
            if let Some(ext) = ext {
                if SLIDE_EXTENSIONS.contains(&ext.as_str()) {
                    // Generate ID from filename (without extension)
                    let id = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .map(sanitize_id)
                        .unwrap_or_else(|| format!("slide_{}", slides.len()));

                    debug!("Found slide: {} at {:?}", id, path);
                    slides.push((id, path));
                }
            }
        }

        info!("Found {} slides in {:?}", slides.len(), self.slides_dir);
        slides
    }

    /// Find slide path by ID
    async fn find_slide_path(&self, id: &str) -> Option<PathBuf> {
        for (slide_id, path) in self.scan_slides_cached().await {
            if slide_id == id {
                return Some(path);
            }
        }
        None
    }

    /// Extract metadata from an OpenSlide handle
    fn extract_metadata(&self, id: &str, path: &Path, slide: &OpenSlide) -> SlideMetadata {
        let (width, height) = slide
            .get_level_dimensions(0)
            .map(|d| (d.w as u64, d.h as u64))
            .unwrap_or((0, 0));

        let num_levels = self.calculate_dzi_levels(width as u32, height as u32);

        let format = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| id.to_string());

        let vendor = slide.get_property_value("openslide.vendor").ok();

        let mpp_x = slide
            .get_property_value("openslide.mpp-x")
            .ok()
            .and_then(|s| s.parse().ok());

        let mpp_y = slide
            .get_property_value("openslide.mpp-y")
            .ok()
            .and_then(|s| s.parse().ok());

        SlideMetadata {
            id: id.to_string(),
            name,
            width,
            height,
            tile_size: self.tile_size,
            num_levels,
            format,
            vendor,
            mpp_x,
            mpp_y,
        }
    }

    /// Calculate the number of DZI levels for given dimensions
    ///
    /// DZI convention: level 0 = 1x1, level N = full resolution
    /// Number of levels = ceil(log2(max(width, height))) + 1
    fn calculate_dzi_levels(&self, width: u32, height: u32) -> u32 {
        if width == 0 || height == 0 {
            return 1;
        }
        let max_dim = std::cmp::max(width, height);
        (max_dim as f64).log2().ceil() as u32 + 1
    }
}

#[async_trait]
impl SlideService for LocalSlideService {
    async fn list_slides(&self) -> Result<Vec<SlideMetadata>, SlideError> {
        let slides = self.scan_slides_cached().await;
        let mut metadata_list = Vec::new();

        for (id, path) in slides {
            // Check cache first
            if let Some(meta) = self.cache.get_metadata(&id) {
                metadata_list.push((*meta).clone());
                continue;
            }

            // Open and extract metadata
            match self.cache.get_or_open(&id, &path).await {
                Ok(slide) => {
                    let meta = self.extract_metadata(&id, &path, &slide);
                    self.cache.set_metadata(&id, meta.clone());
                    metadata_list.push(meta);
                }
                Err(e) => {
                    warn!("Failed to open slide {}: {}", id, e);
                    // Skip this slide but continue with others
                }
            }
        }

        Ok(metadata_list)
    }

    async fn get_slide(&self, id: &str) -> Result<SlideMetadata, SlideError> {
        if let Some(meta) = self.cache.get_metadata(id) {
            return Ok((*meta).clone());
        }

        // Find the slide path
        let path = self
            .find_slide_path(id)
            .await
            .ok_or_else(|| SlideError::NotFound(id.to_string()))?;

        // Open and extract metadata
        let slide = self.cache.get_or_open(id, &path).await?;
        let meta = self.extract_metadata(id, &path, &slide);
        self.cache.set_metadata(id, meta.clone());

        Ok(meta)
    }
}

/// Sanitize a string to create a valid ID
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_dzi_levels() {
        let service = LocalSlideService {
            slides_dir: PathBuf::from("/tmp"),
            cache: SlideCache::new(10),
            tile_size: 256,
        };

        // 1x1 -> 1 level
        assert_eq!(service.calculate_dzi_levels(1, 1), 1);

        // 256x256 -> 9 levels (1, 2, 4, 8, 16, 32, 64, 128, 256)
        assert_eq!(service.calculate_dzi_levels(256, 256), 9);

        // 100000x100000 -> 18 levels
        assert_eq!(service.calculate_dzi_levels(100000, 100000), 18);
    }

    #[test]
    fn test_sanitize_id() {
        assert_eq!(sanitize_id("test-slide_123"), "test-slide_123");
        assert_eq!(sanitize_id("slide with spaces"), "slide_with_spaces");
        assert_eq!(
            sanitize_id("TCGA-AB-1234.svs.extra"),
            "TCGA-AB-1234.svs.extra"
        );
    }
}
