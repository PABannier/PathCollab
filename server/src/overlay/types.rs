//! Overlay types and error definitions

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur during overlay processing
#[derive(Error, Debug)]
pub enum OverlayError {
    #[error("Failed to read overlay file: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Failed to parse protobuf: {0}")]
    DecodeError(#[from] prost::DecodeError),

    #[error("Invalid overlay data: {0}")]
    ValidationError(String),

    #[error("Overlay file too large: {size} bytes (max {max} bytes)")]
    FileTooLarge { size: u64, max: u64 },

    #[error("Too many cells: {count} (max {max})")]
    TooManyCells { count: u64, max: u64 },

    #[error("Too many tiles: {count} (max {max})")]
    TooManyTiles { count: u64, max: u64 },

    #[error("Parse timeout: operation took longer than {timeout_secs} seconds")]
    Timeout { timeout_secs: u64 },
}

/// Parsed overlay data ready for indexing and serving
#[derive(Debug, Clone)]
pub struct ParsedOverlay {
    /// Unique identifier (content-addressed)
    pub content_sha256: String,

    /// Source file metadata
    pub slide_id: String,
    pub model_name: String,
    pub model_version: String,
    pub created_at: u64,

    /// Slide dimensions
    pub slide_width: u32,
    pub slide_height: u32,
    pub tile_size: u32,

    /// Class definitions
    pub tissue_classes: Vec<TissueClassDef>,
    pub cell_classes: Vec<CellClassDef>,

    /// Statistics
    pub total_cells: u64,
    pub total_tissue_tiles: u64,
}

/// Tissue class definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TissueClassDef {
    pub id: u32,
    pub name: String,
    pub color: String,
}

/// Cell class definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellClassDef {
    pub id: u32,
    pub name: String,
    pub color: String,
}

/// Cell data for indexing and rendering
#[derive(Debug, Clone)]
pub struct CellData {
    pub centroid_x: f32,
    pub centroid_y: f32,
    pub class_id: u32,
    pub confidence: f32,
    pub bbox_min_x: f32,
    pub bbox_min_y: f32,
    pub bbox_max_x: f32,
    pub bbox_max_y: f32,
    pub vertices: Vec<i32>,
    pub area: f32,
}

/// Tissue tile data
#[derive(Debug, Clone)]
pub struct TissueTileData {
    pub tile_x: u32,
    pub tile_y: u32,
    pub level: u32,
    pub class_data: Vec<u8>,
    pub confidence_data: Option<Vec<u8>>,
}

/// Overlay manifest for HTTP serving
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayManifest {
    pub overlay_id: String,
    pub content_sha256: String,
    pub raster_base_url: String,
    pub vec_base_url: String,
    pub chunk_format: String,
    pub tile_size: u32,
    pub levels: u32,
    pub tissue_classes: Vec<TissueClassDef>,
    pub cell_classes: Vec<CellClassDef>,
    pub total_cells: u64,
    pub total_tissue_tiles: u64,
}

/// Validation limits
pub mod limits {
    pub const MAX_OVERLAY_SIZE_BYTES: u64 = 500 * 1024 * 1024; // 500MB
    pub const MAX_CELLS: u64 = 5_000_000;
    pub const MAX_TILES: u64 = 500_000;
    pub const MAX_PARSE_SECONDS: u64 = 60;
    pub const CELL_CLASS_MAX: u32 = 14;
    pub const TISSUE_CLASS_MAX: u32 = 7;
}
