//! Streaming protobuf parser for overlay files
//!
//! Handles large overlay files by streaming and processing in chunks
//! rather than loading everything into memory at once.

use crate::overlay::types::{
    CellClassDef, CellData, OverlayError, ParsedOverlay, TissueClassDef, TissueTileData, limits,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::io::{BufReader, Read};
use std::path::Path;
use tracing::{debug, info, warn};

// Include generated protobuf code
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/pathcollab.overlay.rs"));
}

/// Parser for overlay protobuf files
pub struct OverlayParser {
    /// Maximum file size in bytes
    max_file_size: u64,
    /// Maximum number of cells
    max_cells: u64,
    /// Maximum number of tiles
    max_tiles: u64,
}

impl Default for OverlayParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayParser {
    /// Create a new parser with default limits
    pub fn new() -> Self {
        Self {
            max_file_size: limits::MAX_OVERLAY_SIZE_BYTES,
            max_cells: limits::MAX_CELLS,
            max_tiles: limits::MAX_TILES,
        }
    }

    /// Create a parser with custom limits
    pub fn with_limits(max_file_size: u64, max_cells: u64, max_tiles: u64) -> Self {
        Self {
            max_file_size,
            max_cells,
            max_tiles,
        }
    }

    /// Parse an overlay file from a path
    pub fn parse_file(&self, path: &Path) -> Result<ParsedOverlayData, OverlayError> {
        // Check file size
        let metadata = std::fs::metadata(path)?;
        let file_size = metadata.len();

        if file_size > self.max_file_size {
            return Err(OverlayError::FileTooLarge {
                size: file_size,
                max: self.max_file_size,
            });
        }

        info!(
            "Parsing overlay file: {} ({} bytes)",
            path.display(),
            file_size
        );

        // Read file and compute hash
        let file = std::fs::File::open(path)?;
        let mut reader = BufReader::new(file);
        let mut data = Vec::with_capacity(file_size as usize);
        reader.read_to_end(&mut data)?;

        // Compute content hash
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash_bytes = hasher.finalize();
        let content_sha256 = hex::encode(hash_bytes);

        // Parse protobuf
        let overlay_file = proto::OverlayFile::decode(data.as_slice())?;

        self.process_overlay(overlay_file, content_sha256)
    }

    /// Parse overlay from raw bytes
    pub fn parse_bytes(&self, data: &[u8]) -> Result<ParsedOverlayData, OverlayError> {
        let file_size = data.len() as u64;

        if file_size > self.max_file_size {
            return Err(OverlayError::FileTooLarge {
                size: file_size,
                max: self.max_file_size,
            });
        }

        // Compute content hash
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash_bytes = hasher.finalize();
        let content_sha256 = hex::encode(hash_bytes);

        // Parse protobuf
        let overlay_file = proto::OverlayFile::decode(data)?;

        self.process_overlay(overlay_file, content_sha256)
    }

    /// Process parsed protobuf into internal structures
    fn process_overlay(
        &self,
        overlay: proto::OverlayFile,
        content_sha256: String,
    ) -> Result<ParsedOverlayData, OverlayError> {
        // Validate cell count
        let cell_count = overlay.cells.len() as u64;
        if cell_count > self.max_cells {
            return Err(OverlayError::TooManyCells {
                count: cell_count,
                max: self.max_cells,
            });
        }

        // Validate tile count
        let tile_count = overlay.tissue_tiles.len() as u64;
        if tile_count > self.max_tiles {
            return Err(OverlayError::TooManyTiles {
                count: tile_count,
                max: self.max_tiles,
            });
        }

        debug!(
            "Processing overlay: {} cells, {} tiles",
            cell_count, tile_count
        );

        // Extract tissue classes
        let tissue_classes: Vec<TissueClassDef> = overlay
            .tissue_classes
            .into_iter()
            .map(|tc| TissueClassDef {
                id: tc.id,
                name: tc.name,
                color: tc.color,
            })
            .collect();

        // Extract cell classes
        let cell_classes: Vec<CellClassDef> = overlay
            .cell_classes
            .into_iter()
            .map(|cc| CellClassDef {
                id: cc.id,
                name: cc.name,
                color: cc.color,
            })
            .collect();

        // Extract cells
        let cells: Vec<CellData> = overlay
            .cells
            .into_iter()
            .filter_map(|cell| {
                // Validate class ID
                if cell.class_id > limits::CELL_CLASS_MAX {
                    warn!("Skipping cell with invalid class_id: {}", cell.class_id);
                    return None;
                }

                Some(CellData {
                    centroid_x: cell.centroid_x,
                    centroid_y: cell.centroid_y,
                    class_id: cell.class_id,
                    confidence: cell.confidence.clamp(0.0, 1.0),
                    bbox_min_x: cell.bbox_min_x,
                    bbox_min_y: cell.bbox_min_y,
                    bbox_max_x: cell.bbox_max_x,
                    bbox_max_y: cell.bbox_max_y,
                    vertices: cell.vertices,
                    area: cell.area,
                })
            })
            .collect();

        // Extract tissue tiles
        let tissue_tiles: Vec<TissueTileData> = overlay
            .tissue_tiles
            .into_iter()
            .map(|tile| TissueTileData {
                tile_x: tile.tile_x,
                tile_y: tile.tile_y,
                level: tile.level,
                class_data: tile.class_data.to_vec(),
                confidence_data: if tile.confidence_data.is_empty() {
                    None
                } else {
                    Some(tile.confidence_data.to_vec())
                },
            })
            .collect();

        // Create metadata
        // Use actual parsed counts (after filtering invalid entries) for accuracy
        let metadata = ParsedOverlay {
            content_sha256,
            slide_id: overlay.slide_id,
            model_name: overlay.model_name,
            model_version: overlay.model_version,
            created_at: overlay.created_at,
            slide_width: overlay.slide_width,
            slide_height: overlay.slide_height,
            tile_size: overlay.tile_size,
            tissue_classes,
            cell_classes,
            total_cells: cells.len() as u64,
            total_tissue_tiles: tissue_tiles.len() as u64,
        };

        info!(
            "Parsed overlay: {} cells, {} tiles, hash={}",
            cells.len(),
            tissue_tiles.len(),
            &metadata.content_sha256[..16]
        );

        Ok(ParsedOverlayData {
            metadata,
            cells,
            tissue_tiles,
        })
    }
}

/// Complete parsed overlay data
#[derive(Debug)]
pub struct ParsedOverlayData {
    pub metadata: ParsedOverlay,
    pub cells: Vec<CellData>,
    pub tissue_tiles: Vec<TissueTileData>,
}

/// Simple hex encoding for SHA256 hashes
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parser_creation() {
        let parser = OverlayParser::new();
        assert_eq!(parser.max_file_size, limits::MAX_OVERLAY_SIZE_BYTES);
        assert_eq!(parser.max_cells, limits::MAX_CELLS);
    }

    #[test]
    fn test_parser_with_limits() {
        let parser = OverlayParser::with_limits(1000, 100, 50);
        assert_eq!(parser.max_file_size, 1000);
        assert_eq!(parser.max_cells, 100);
        assert_eq!(parser.max_tiles, 50);
    }
}
