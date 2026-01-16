//! Overlay types and error definitions

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
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

    /// Microns per pixel (from slide metadata)
    pub mpp: Option<f32>,

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
    pub class_id: u32,
    pub confidence: f32,
    pub vertices: Vec<i32>,
    pub bbox_min_x: f32,
    pub bbox_min_y: f32,
    pub bbox_max_x: f32,
    pub bbox_max_y: f32,
}

impl CellData {
    pub fn new(class_id: u32, confidence: f32, vertices: Vec<i32>, abs_coords: Vec<(f32, f32)>) -> Self {
        let (bbox_min_x, bbox_max_x, bbox_min_y, bbox_max_y) = compute_bbox(&abs_coords);
        Self {
            class_id,
            confidence: confidence.clamp(0.0, 1.0),
            vertices,
            bbox_min_x,
            bbox_min_y,
            bbox_max_x,
            bbox_max_y,
        }
    }
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

/// Compute bounding box from a list of (x, y) coordinates
pub fn compute_bbox(coords: &[(f32, f32)]) -> (f32, f32, f32, f32) {
    if coords.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let (mut min_x, mut max_x) = (f32::INFINITY, f32::NEG_INFINITY);
    let (mut min_y, mut max_y) = (f32::INFINITY, f32::NEG_INFINITY);
    for (x, y) in coords {
        min_x = min_x.min(*x);
        max_x = max_x.max(*x);
        min_y = min_y.min(*y);
        max_y = max_y.max(*y);
    }
    (min_x, max_x, min_y, max_y)
}

/// Compute polygon area using the shoelace formula
pub fn compute_polygon_area(coords: &[(f32, f32)]) -> f32 {
    if coords.len() < 3 {
        return 0.0;
    }
    let mut area = 0.0f32;
    let n = coords.len();
    for i in 0..n {
        let j = (i + 1) % n;
        area += coords[i].0 * coords[j].1;
        area -= coords[j].0 * coords[i].1;
    }
    (area / 2.0).abs()
}

/// Default colors for tissue classes (8 classes)
pub fn default_tissue_color(id: u32) -> String {
    const COLORS: &[&str] = &[
        "#EF4444", // Red (Tumor)
        "#F59E0B", // Amber (Stroma)
        "#6B7280", // Gray (Necrosis)
        "#3B82F6", // Blue (Lymphocytes)
        "#A855F7", // Purple (Mucus)
        "#EC4899", // Pink (Smooth Muscle)
        "#FBBF24", // Yellow (Adipose)
        "#E5E7EB", // Light gray (Background)
    ];
    COLORS.get(id as usize).unwrap_or(&"#9CA3AF").to_string()
}

/// Default colors for cell classes (15 classes)
pub fn default_cell_color(id: u32) -> String {
    const COLORS: &[&str] = &[
        "#DC2626", // Red (Cancer cell)
        "#2563EB", // Blue (Lymphocyte)
        "#7C3AED", // Violet (Macrophage)
        "#0891B2", // Cyan (Neutrophil)
        "#4F46E5", // Indigo (Plasma cell)
        "#D97706", // Amber (Fibroblast)
        "#059669", // Green (Endothelial)
        "#DB2777", // Pink (Epithelial)
        "#EA580C", // Orange (Myofibroblast)
        "#8B5CF6", // Purple (Dendritic)
        "#0D9488", // Teal (Mast cell)
        "#E11D48", // Rose (Mitotic)
        "#6B7280", // Gray (Apoptotic)
        "#7C2D12", // Brown (Giant cell)
        "#9CA3AF", // Light gray (Unknown)
    ];
    COLORS.get(id as usize).unwrap_or(&"#9CA3AF").to_string()
}

/// Get current Unix timestamp in milliseconds
pub fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
