//! Slide-related types and error definitions

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur when working with slides
#[derive(Debug, Error)]
pub enum SlideError {
    #[error("Slide not found: {0}")]
    NotFound(String),

    #[error("Failed to open slide: {0}")]
    OpenError(String),

    #[error("Failed to read tile: {0}")]
    TileError(String),

    #[error("Invalid level: {0}")]
    InvalidLevel(u32),

    #[error("Invalid tile coordinates: level={level}, x={x}, y={y}")]
    InvalidTileCoordinates { level: u32, x: u32, y: u32 },

    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Metadata for a whole-slide image
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideMetadata {
    /// Unique identifier (derived from filename)
    pub id: String,
    /// Display name
    pub name: String,
    /// Full resolution width in pixels
    pub width: u64,
    /// Full resolution height in pixels
    pub height: u64,
    /// Tile size for serving
    pub tile_size: u32,
    /// Number of DZI levels (for OpenSeadragon)
    pub num_levels: u32,
    /// File format (svs, ndpi, tiff, etc.)
    pub format: String,
    /// Scanner vendor (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// Microns per pixel X (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mpp_x: Option<f64>,
    /// Microns per pixel Y (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mpp_y: Option<f64>,
    /// Whether an overlay file exists for this slide
    #[serde(default)]
    pub has_overlay: bool,
}

/// Request for a specific tile
#[derive(Debug, Clone)]
pub struct TileRequest {
    /// Slide identifier
    pub slide_id: String,
    /// DZI pyramid level (0 = smallest, max = full resolution)
    pub level: u32,
    /// Tile X coordinate
    pub x: u32,
    /// Tile Y coordinate
    pub y: u32,
}

/// Summary info for slide listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideListItem {
    pub id: String,
    pub name: String,
    pub width: u64,
    pub height: u64,
    pub format: String,
    /// Whether an overlay file exists for this slide
    #[serde(default)]
    pub has_overlay: bool,
}

impl From<SlideMetadata> for SlideListItem {
    fn from(m: SlideMetadata) -> Self {
        Self {
            id: m.id,
            name: m.name,
            width: m.width,
            height: m.height,
            format: m.format,
            has_overlay: m.has_overlay,
        }
    }
}
