//! Overlay-related types and error definitions

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur when working with overlays
#[derive(Debug, Error)]
pub enum OverlayError {
    #[error("Overlay not found for slide: {0}")]
    NotFound(String),

    #[error("Failed to parse overlay file: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Region out of bounds: region ({x}, {y}, {width}x{height}) exceeds bounds")]
    RegionOutOfBounds {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

/// Point in 2D space
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

/// Metadata about an overlay
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayMetadata {
    /// Overlay identifier
    pub id: String,
    /// Associated slide identifier
    pub slide_id: String,
    /// Microns per pixel
    pub mpp: f32,
    /// Total number of cells in the overlay
    pub cell_count: usize,
    /// List of unique cell types present
    pub cell_types: Vec<String>,
    /// Name of the cell detection model used
    pub cell_model_name: String,
    /// Name of the tissue segmentation model used
    pub tissue_model_name: String,
}

/// Cell mask polygon for API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellMask {
    /// Unique cell identifier
    pub cell_id: i32,
    /// Cell type classification
    pub cell_type: String,
    /// Confidence score (0.0-1.0)
    pub confidence: f32,
    /// Polygon boundary coordinates
    pub coordinates: Vec<Point>,
    /// Centroid of the cell
    pub centroid: Point,
}

/// Region query request
#[derive(Debug, Clone)]
pub struct RegionRequest {
    /// Slide identifier
    pub slide_id: String,
    /// X coordinate of region top-left corner
    pub x: f64,
    /// Y coordinate of region top-left corner
    pub y: f64,
    /// Width of the region
    pub width: f64,
    /// Height of the region
    pub height: f64,
    /// Optional pyramid level (for coordinate scaling)
    pub level: Option<u32>,
}

/// Response for cells in region query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellsInRegionResponse {
    /// List of cells within the region
    pub cells: Vec<CellMask>,
    /// Total count of cells returned
    pub total_count: usize,
    /// The queried region
    pub region: RegionInfo,
}

/// Region info for response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
