//! Streaming protobuf parser for overlay files
//!
//! Handles overlay files containing cell segmentation polygons and tissue maps
//! from ML inference pipelines.

use crate::overlay::types::{
    CellClassDef, CellData, OverlayError, ParsedOverlay, TissueClassDef, TissueTileData,
    current_timestamp_ms, default_cell_color, default_tissue_color, limits,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::Path;
use tracing::info;

// Include generated protobuf code (proto2 format from DataProtoPolygon package)
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/data_proto_polygon.rs"));
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
        let slide_data = proto::SlideSegmentationData::decode(data.as_slice())?;

        self.process_slide_data(slide_data, content_sha256)
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
        let slide_data = proto::SlideSegmentationData::decode(data)?;

        self.process_slide_data(slide_data, content_sha256)
    }

    /// Process parsed SlideSegmentationData into internal structures
    fn process_slide_data(
        &self,
        slide_data: proto::SlideSegmentationData,
        content_sha256: String,
    ) -> Result<ParsedOverlayData, OverlayError> {
        // Build cell type name -> class_id mapping (discovered dynamically)
        let mut cell_type_map: HashMap<String, u32> = HashMap::new();
        let mut next_cell_class_id = 0u32;

        // Build tissue class definitions from the mapping in the proto
        let tissue_classes: Vec<TissueClassDef> = slide_data
            .tissue_class_mapping
            .iter()
            .map(|(id, name)| TissueClassDef {
                id: *id as u32,
                name: name.clone(),
                color: default_tissue_color(*id as u32),
            })
            .collect();

        // Track slide dimensions (computed from tiles)
        let mut max_x: f32 = 0.0;
        let mut max_y: f32 = 0.0;
        let mut tile_size: u32 = 256; // Default

        // Collect all cells and tissue tiles
        let mut cells: Vec<CellData> = Vec::new();
        let mut tissue_tiles: Vec<TissueTileData> = Vec::new();

        // Count total cells across all tiles for validation
        let total_cell_count: usize = slide_data.tiles.iter().map(|t| t.masks.len()).sum();
        if total_cell_count as u64 > self.max_cells {
            return Err(OverlayError::TooManyCells {
                count: total_cell_count as u64,
                max: self.max_cells,
            });
        }

        // Validate tile count
        let tile_count = slide_data.tiles.len() as u64;
        if tile_count > self.max_tiles {
            return Err(OverlayError::TooManyTiles {
                count: tile_count,
                max: self.max_tiles,
            });
        }

        let max_deepzoom_level = slide_data.max_level;

        info!(
            "Processing slide {} with {} tiles, {} total cells, max_deepzoom_level={}",
            slide_data.slide_id, tile_count, total_cell_count, max_deepzoom_level
        );

        // Process each tile
        for tile in slide_data.tiles {
            // Update tile size from first tile
            if tile_size == 256 && tile.width > 0 {
                tile_size = tile.width as u32;
            }

            // Proto x,y ARE tile indices at the given level
            let tile_x = tile.x as u32;
            let tile_y = tile.y as u32;

            // Apply scale factor if the DeepZoom level of inference is not equivalent
            // to the maximum DeepZoom level available on the slide
            let scale_factor = if max_deepzoom_level != tile.level {
                (1 << (max_deepzoom_level - tile.level)) as f32
            } else {
                1.0
            };

            // Compute tile origin in full-resolution pixel coordinates
            // The tile indices are at the model inference level, each tile is 224x224 pixels
            let tile_origin_x = tile_x as f32 * tile.width as f32 * scale_factor;
            let tile_origin_y = tile_y as f32 * tile.height as f32 * scale_factor;

            // Update max dimensions (in full-resolution coordinates)
            max_x = max_x.max(tile_origin_x + tile.width as f32 * scale_factor);
            max_y = max_y.max(tile_origin_y + tile.height as f32 * scale_factor);

            // Process cell polygons (masks)
            for polygon in tile.masks {
                // Get or create class_id for this cell_type
                let class_id = *cell_type_map
                    .entry(polygon.cell_type.clone())
                    .or_insert_with(|| {
                        let id = next_cell_class_id;
                        next_cell_class_id += 1;
                        id
                    });

                // Convert polygon coordinates from tile-relative to absolute
                // and collect as (x, y) tuples for bbox/area computation
                let abs_coords: Vec<(f32, f32)> = polygon
                    .coordinates
                    .iter()
                    .map(|p| (tile_origin_x + p.x * scale_factor, tile_origin_y + p.y * scale_factor))
                    .collect();

                // Pack vertices as i32 array for rendering
                let vertices: Vec<i32> = abs_coords
                    .iter()
                    .flat_map(|(x, y)| [*x as i32, *y as i32])
                    .collect();

                let cell_data = CellData::new(class_id, polygon.confidence, vertices, abs_coords);
                cells.push(cell_data);
            }

            // Extract tissue segmentation data
            // Store at level 0 (not the protobuf level) since the frontend expects
            // a flat tile grid. The protobuf level indicates the inference resolution.
            let tissue_map = &tile.tissue_segmentation_map;
            tissue_tiles.push(TissueTileData {
                tile_x,
                tile_y,
                level: 0, // Always store at level 0 for flat tile grid
                class_data: tissue_map.data.to_vec(),
                confidence_data: None, // Not provided in this proto format
            });
        }

        // Build cell class definitions from discovered types
        let mut cell_classes: Vec<CellClassDef> = cell_type_map
            .into_iter()
            .map(|(name, id)| CellClassDef {
                id,
                name,
                color: default_cell_color(id),
            })
            .collect();
        // Sort by id for consistent ordering
        cell_classes.sort_by_key(|c| c.id);

        // Create metadata
        let metadata = ParsedOverlay {
            content_sha256,
            slide_id: slide_data.slide_id,
            model_name: slide_data.cell_model_name,
            model_version: "1.0".to_string(), // Not in proto, use default
            created_at: current_timestamp_ms(),
            slide_width: max_x as u32,
            slide_height: max_y as u32,
            tile_size,
            mpp: Some(slide_data.mpp),
            tissue_classes,
            cell_classes,
            total_cells: cells.len() as u64,
            total_tissue_tiles: tissue_tiles.len() as u64,
        };

        info!(
            "Parsed overlay: {} cells, {} tiles, {} cell types, hash={}",
            cells.len(),
            tissue_tiles.len(),
            metadata.cell_classes.len(),
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

    fn create_test_slide_data() -> proto::SlideSegmentationData {
        use proto::segmentation_polygon::Point;

        let mut slide = proto::SlideSegmentationData {
            slide_id: "test-slide".to_string(),
            slide_path: "/path/to/slide.svs".to_string(),
            mpp: 0.25,
            max_level: 5,
            cell_model_name: "hovernet".to_string(),
            tissue_model_name: "tissue_v1".to_string(),
            ..Default::default()
        };

        // Add a tile with one cell
        let cell = proto::SegmentationPolygon {
            cell_id: 1,
            cell_type: "Tumor".to_string(),
            confidence: 0.95,
            centroid: Point { x: 128.0, y: 128.0 },
            coordinates: vec![
                Point { x: 100.0, y: 100.0 },
                Point { x: 150.0, y: 100.0 },
                Point { x: 150.0, y: 150.0 },
                Point { x: 100.0, y: 150.0 },
            ],
        };

        let mut tile = proto::TileSegmentationData {
            tile_id: "tile_0_0".to_string(),
            level: 0,
            x: 0.0,
            y: 0.0,
            width: 256,
            height: 256,
            ..Default::default()
        };
        tile.masks.push(cell);

        // Add tissue data
        tile.tissue_segmentation_map = proto::TissueSegmentationMap {
            data: vec![0u8; 256 * 256].into(),
            width: 256,
            height: 256,
            dtype: "uint8".to_string(),
        };

        slide.tiles.push(tile);
        slide
            .tissue_class_mapping
            .insert(0, "Background".to_string());
        slide.tissue_class_mapping.insert(1, "Tumor".to_string());

        slide
    }

    #[test]
    fn test_parse_slide_segmentation_data() {
        let slide = create_test_slide_data();
        let data = slide.encode_to_vec();

        let parser = OverlayParser::new();
        let result = parser.parse_bytes(&data).unwrap();

        assert_eq!(result.metadata.slide_id, "test-slide");
        assert_eq!(result.cells.len(), 1);
        assert_eq!(result.cells[0].class_id, 0); // First discovered type
        assert!((result.cells[0].confidence - 0.95).abs() < 0.01);
        assert_eq!(result.tissue_tiles.len(), 1);
        assert_eq!(result.metadata.cell_classes.len(), 1);
        assert_eq!(result.metadata.cell_classes[0].name, "Tumor");
    }

    #[test]
    fn test_multiple_cell_types() {
        use proto::segmentation_polygon::Point;

        let mut slide = create_test_slide_data();

        // Add a second cell with different type
        let cell2 = proto::SegmentationPolygon {
            cell_id: 2,
            cell_type: "Lymphocyte".to_string(),
            confidence: 0.88,
            centroid: Point { x: 50.0, y: 50.0 },
            coordinates: vec![
                Point { x: 40.0, y: 40.0 },
                Point { x: 60.0, y: 60.0 },
                Point { x: 60.0, y: 40.0 },
                Point { x: 40.0, y: 60.0 },
            ],
        };
        slide.tiles[0].masks.push(cell2);

        let data = slide.encode_to_vec();
        let parser = OverlayParser::new();
        let result = parser.parse_bytes(&data).unwrap();

        assert_eq!(result.cells.len(), 2);
        assert_eq!(result.metadata.cell_classes.len(), 2);

        // Check that cell types are mapped correctly
        let tumor_class = result
            .metadata
            .cell_classes
            .iter()
            .find(|c| c.name == "Tumor");
        let lymph_class = result
            .metadata
            .cell_classes
            .iter()
            .find(|c| c.name == "Lymphocyte");
        assert!(tumor_class.is_some());
        assert!(lymph_class.is_some());
    }
}
