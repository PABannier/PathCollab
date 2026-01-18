//! Local slide service using OpenSlide

use std::path::{Path, PathBuf};
use std::time::Instant;

use async_trait::async_trait;
use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, RgbaImage};
use metrics::{counter, histogram};
use openslide_rs::{Address, OpenSlide, Region, Size};
use tracing::{debug, error, info, warn};

use crate::config::SlideConfig;

use super::cache::SlideCache;
use super::service::SlideService;
use super::types::{SlideError, SlideMetadata, TileRequest};

/// Supported slide file extensions
const SLIDE_EXTENSIONS: &[&str] = &["svs", "ndpi", "tiff", "tif", "vms", "vmu", "scn", "mrxs"];

/// Local slide service using OpenSlide
pub struct LocalSlideService {
    slides_dir: PathBuf,
    cache: SlideCache,
    tile_size: u32,
    jpeg_quality: u8,
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
            "Initialized local slide service with directory: {:?}",
            slides_dir
        );

        Ok(Self {
            slides_dir: slides_dir.clone(),
            cache: SlideCache::new(config.max_cached_slides),
            tile_size: config.tile_size,
            jpeg_quality: config.jpeg_quality,
        })
    }

    /// Scan the slides directory for slide files
    fn scan_slides(&self) -> Vec<(String, PathBuf)> {
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
    fn find_slide_path(&self, id: &str) -> Option<PathBuf> {
        // Scan and find matching ID
        for (slide_id, path) in self.scan_slides() {
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

    /// Convert DZI level and tile coordinates to OpenSlide read parameters
    ///
    /// Returns: (openslide_level, x_level0, y_level0, read_width, read_height, scale_factor, target_tile_width, target_tile_height)
    #[allow(clippy::type_complexity)]
    fn dzi_to_openslide_params(
        &self,
        slide: &OpenSlide,
        metadata: &SlideMetadata,
        dzi_level: u32,
        tile_x: u32,
        tile_y: u32,
    ) -> Result<(u32, u32, u32, u32, u32, f64, u32, u32), SlideError> {
        let dzi_max_level = metadata.num_levels - 1;

        if dzi_level > dzi_max_level {
            return Err(SlideError::InvalidLevel(dzi_level));
        }

        // Calculate the scale factor for this DZI level
        // At dzi_max_level (full res), scale = 1
        // At dzi_max_level - 1, scale = 2
        // At dzi_max_level - n, scale = 2^n
        let levels_from_max = dzi_max_level - dzi_level;
        let dzi_scale = 2.0_f64.powi(levels_from_max as i32);

        // Calculate dimensions at this DZI level
        let level_width = (metadata.width as f64 / dzi_scale).ceil() as u32;
        let level_height = (metadata.height as f64 / dzi_scale).ceil() as u32;

        // Calculate tile bounds at this level
        let tile_x_start = tile_x * self.tile_size;
        let tile_y_start = tile_y * self.tile_size;

        // Validate tile coordinates - return error for out-of-bounds requests
        if tile_x_start >= level_width || tile_y_start >= level_height {
            return Err(SlideError::InvalidTileCoordinates {
                level: dzi_level,
                x: tile_x,
                y: tile_y,
            });
        }

        // Calculate actual tile size (may be smaller at edges)
        let actual_tile_width = std::cmp::min(self.tile_size, level_width - tile_x_start);
        let actual_tile_height = std::cmp::min(self.tile_size, level_height - tile_y_start);

        // Convert tile coordinates to level 0 (full resolution) coordinates
        let x_level0 = (tile_x_start as f64 * dzi_scale) as u32;
        let y_level0 = (tile_y_start as f64 * dzi_scale) as u32;

        // Find the best OpenSlide level to read from
        let os_level_count = slide.get_level_count().unwrap_or(1);
        let mut best_os_level = 0u32;
        let mut best_downsample = 1.0f64;

        for l in 0..os_level_count {
            let downsample = slide.get_level_downsample(l).unwrap_or(1.0);
            // Find the level with the largest downsample that's <= our target
            if downsample <= dzi_scale && downsample >= best_downsample {
                best_os_level = l;
                best_downsample = downsample;
            }
        }

        // Calculate how much we need to read (at the OpenSlide level)
        // and how much we need to scale the result
        let os_to_dzi_scale = dzi_scale / best_downsample;
        let read_width = (actual_tile_width as f64 * os_to_dzi_scale).ceil() as u32;
        let read_height = (actual_tile_height as f64 * os_to_dzi_scale).ceil() as u32;

        Ok((
            best_os_level,
            x_level0,
            y_level0,
            read_width,
            read_height,
            os_to_dzi_scale,
            actual_tile_width,
            actual_tile_height,
        ))
    }

    /// Read a tile from the slide and encode as JPEG
    async fn read_tile_jpeg(
        &self,
        slide: &OpenSlide,
        metadata: &SlideMetadata,
        level: u32,
        x: u32,
        y: u32,
    ) -> Result<Vec<u8>, SlideError> {
        let (os_level, x_l0, y_l0, read_w, read_h, scale_factor, target_w, target_h) =
            self.dzi_to_openslide_params(slide, metadata, level, x, y)?;

        debug!(
            "Reading tile: level={}, x={}, y={} -> os_level={}, pos=({},{}), read={}x{}, target={}x{}, scale={}",
            level, x, y, os_level, x_l0, y_l0, read_w, read_h, target_w, target_h, scale_factor
        );

        // Read the region from OpenSlide
        let read_start = Instant::now();
        let region = Region {
            address: Address { x: x_l0, y: y_l0 },
            level: os_level,
            size: Size {
                w: read_w,
                h: read_h,
            },
        };

        let rgba_image: RgbaImage = slide.read_image_rgba(&region).map_err(|e| {
            SlideError::TileError(format!(
                "Failed to read region at level {} ({},{}): {}",
                level, x, y, e
            ))
        })?;
        histogram!("pathcollab_tile_phase_duration_seconds", "phase" => "read")
            .record(read_start.elapsed());

        // Resize if we need to scale down
        let final_image = if scale_factor > 1.001 {
            let resize_start = Instant::now();
            let resized = image::imageops::resize(
                &rgba_image,
                target_w,
                target_h,
                image::imageops::FilterType::Lanczos3,
            );
            histogram!("pathcollab_tile_phase_duration_seconds", "phase" => "resize")
                .record(resize_start.elapsed());
            resized
        } else {
            rgba_image
        };

        // Encode to JPEG
        let encode_start = Instant::now();
        let result = self.encode_jpeg(&final_image);
        histogram!("pathcollab_tile_phase_duration_seconds", "phase" => "encode")
            .record(encode_start.elapsed());

        result
    }

    /// Encode RGBA image to JPEG
    fn encode_jpeg(&self, rgba: &RgbaImage) -> Result<Vec<u8>, SlideError> {
        // Convert RGBA to RGB (JPEG doesn't support alpha)
        let rgb = image::DynamicImage::ImageRgba8(rgba.clone()).into_rgb8();

        let mut buffer = Vec::new();
        let encoder = JpegEncoder::new_with_quality(&mut buffer, self.jpeg_quality);
        encoder
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| SlideError::TileError(format!("JPEG encoding failed: {}", e)))?;

        Ok(buffer)
    }
}

#[async_trait]
impl SlideService for LocalSlideService {
    async fn list_slides(&self) -> Result<Vec<SlideMetadata>, SlideError> {
        let slides = self.scan_slides();
        let mut metadata_list = Vec::new();

        for (id, path) in slides {
            // Check cache first
            if let Some(meta) = self.cache.get_metadata(&id).await {
                metadata_list.push(meta);
                continue;
            }

            // Open and extract metadata
            match self.cache.get_or_open(&id, &path).await {
                Ok(slide) => {
                    let meta = self.extract_metadata(&id, &path, &slide);
                    self.cache.set_metadata(&id, meta.clone()).await;
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
        // Check cache first
        if let Some(meta) = self.cache.get_metadata(id).await {
            return Ok(meta);
        }

        // Find the slide path
        let path = self
            .find_slide_path(id)
            .ok_or_else(|| SlideError::NotFound(id.to_string()))?;

        // Open and extract metadata
        let slide = self.cache.get_or_open(id, &path).await?;
        let meta = self.extract_metadata(id, &path, &slide);
        self.cache.set_metadata(id, meta.clone()).await;

        Ok(meta)
    }

    async fn get_tile(&self, request: &TileRequest) -> Result<Vec<u8>, SlideError> {
        let start = Instant::now();
        counter!("pathcollab_tile_requests_total").increment(1);

        // Helper to record metrics on all exit paths
        let record_metrics = |result: &Result<Vec<u8>, SlideError>, start: Instant| {
            histogram!("pathcollab_tile_duration_seconds").record(start.elapsed());
            if result.is_err() {
                counter!("pathcollab_tile_errors_total").increment(1);
            }
        };

        // Get metadata (will open slide if needed, caching the slide handle)
        let metadata = match self.get_slide(&request.slide_id).await {
            Ok(m) => m,
            Err(e) => {
                let result = Err(e);
                record_metrics(&result, start);
                return result;
            }
        };

        // Get cached slide handle (already cached by get_slide above)
        let slide = match self.cache.get_cached(&request.slide_id).await {
            Some(s) => s,
            None => {
                // This should not happen since get_slide succeeded, but handle gracefully
                let result = Err(SlideError::NotFound(request.slide_id.clone()));
                record_metrics(&result, start);
                return result;
            }
        };

        // Read and encode the tile
        let result = self
            .read_tile_jpeg(&slide, &metadata, request.level, request.x, request.y)
            .await;

        // Record overall tile latency
        record_metrics(&result, start);

        result
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
        let _config = SlideConfig {
            source_mode: crate::config::SlideSourceMode::Local,
            slides_dir: PathBuf::from("/tmp"),
            tile_size: 256,
            jpeg_quality: 85,
            max_cached_slides: 10,
        };
        let service = LocalSlideService {
            slides_dir: PathBuf::from("/tmp"),
            cache: SlideCache::new(10),
            tile_size: 256,
            jpeg_quality: 85,
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
