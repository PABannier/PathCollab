//! Derive pipeline for building raster tiles and vector chunks
//!
//! Takes parsed overlay data and generates:
//! - Raster tiles: tissue heatmaps resampled from 224 to 256
//! - Vector chunks: cell data grouped by tile for streaming

use crate::overlay::index::TileBinIndex;
use crate::overlay::parser::ParsedOverlayData;
use std::collections::HashMap;
use tracing::{debug, info};

/// Configuration for derive pipeline
#[derive(Debug, Clone)]
pub struct DeriveConfig {
    /// Output tile size (default 256)
    pub tile_size: u32,
    /// Source tile size from model (typically 224)
    pub source_tile_size: u32,
    /// Number of pyramid levels to generate
    pub num_levels: u32,
    /// Maximum cells per vector chunk
    pub max_cells_per_chunk: usize,
}

impl Default for DeriveConfig {
    fn default() -> Self {
        Self {
            tile_size: 256,
            source_tile_size: 224,
            num_levels: 10,
            max_cells_per_chunk: 10000,
        }
    }
}

/// Derived overlay data ready for serving
pub struct DerivedOverlay {
    /// Content hash for cache key
    pub content_sha256: String,
    /// Raster tiles by (level, x, y)
    pub raster_tiles: HashMap<(u32, u32, u32), RasterTile>,
    /// Vector chunks by (level, x, y)
    pub vector_chunks: HashMap<(u32, u32, u32), VectorChunk>,
    /// Spatial index for viewport queries
    pub index: TileBinIndex,
    /// Manifest for HTTP serving
    pub manifest: OverlayManifestData,
}

/// Raster tile data (tissue heatmap)
#[derive(Debug, Clone)]
pub struct RasterTile {
    /// Tile position
    pub level: u32,
    pub x: u32,
    pub y: u32,
    /// RGBA pixel data (tile_size x tile_size x 4)
    pub rgba_data: Vec<u8>,
    /// Compressed WebP data for serving
    pub webp_data: Option<Vec<u8>>,
}

/// Vector chunk data (cells in a tile)
#[derive(Debug, Clone)]
pub struct VectorChunk {
    /// Tile position
    pub level: u32,
    pub x: u32,
    pub y: u32,
    /// Cells in this chunk
    pub cells: Vec<ChunkCell>,
    /// Compressed data for serving (msgpack + zstd)
    pub compressed_data: Option<Vec<u8>>,
}

/// Cell data optimized for chunks
#[derive(Debug, Clone)]
pub struct ChunkCell {
    pub class_id: u8,
    pub confidence: u8,     // Quantized 0-255
    pub centroid_x: i16,    // Relative to tile origin
    pub centroid_y: i16,    // Relative to tile origin
    pub vertices: Vec<i32>, // Absolute slide coordinates (full resolution pixels)
}

/// Manifest data for HTTP serving
#[derive(Debug, Clone)]
pub struct OverlayManifestData {
    pub content_sha256: String,
    pub tile_size: u32,
    pub levels: u32,
    pub total_raster_tiles: usize,
    pub total_vector_chunks: usize,
}

/// Derive pipeline
pub struct DerivePipeline {
    config: DeriveConfig,
}

impl Default for DerivePipeline {
    fn default() -> Self {
        Self::new(DeriveConfig::default())
    }
}

impl DerivePipeline {
    pub fn new(config: DeriveConfig) -> Self {
        Self { config }
    }

    /// Derive all tiles and chunks from parsed overlay
    pub fn derive(&self, parsed: ParsedOverlayData) -> DerivedOverlay {
        info!(
            "Starting derive pipeline: {} cells, {} tiles",
            parsed.cells.len(),
            parsed.tissue_tiles.len()
        );

        // Build spatial index
        let mut index = TileBinIndex::new(self.config.tile_size, self.config.num_levels);
        index.build(&parsed.cells, true);

        // Derive raster tiles from tissue data
        let raster_tiles = self.derive_raster_tiles(&parsed);

        // Derive vector chunks from cell data
        let vector_chunks = self.derive_vector_chunks(&parsed);

        let max_level = raster_tiles
            .keys()
            .map(|(level, _, _)| *level)
            .max()
            .unwrap_or(0);
        let levels = max_level + 1;

        let manifest = OverlayManifestData {
            content_sha256: parsed.metadata.content_sha256.clone(),
            tile_size: self.config.tile_size,
            levels,
            total_raster_tiles: raster_tiles.len(),
            total_vector_chunks: vector_chunks.len(),
        };

        info!(
            "Derive complete: {} raster tiles, {} vector chunks",
            raster_tiles.len(),
            vector_chunks.len()
        );

        DerivedOverlay {
            content_sha256: parsed.metadata.content_sha256,
            raster_tiles,
            vector_chunks,
            index,
            manifest,
        }
    }

    /// Derive raster tiles from tissue segmentation data
    fn derive_raster_tiles(
        &self,
        parsed: &ParsedOverlayData,
    ) -> HashMap<(u32, u32, u32), RasterTile> {
        let mut tiles = HashMap::new();

        // Debug: analyze tile coordinate distribution
        let mut level_counts: HashMap<u32, usize> = HashMap::new();
        let mut unique_keys: std::collections::HashSet<(u32, u32, u32)> = std::collections::HashSet::new();

        for tile in &parsed.tissue_tiles {
            *level_counts.entry(tile.level).or_insert(0) += 1;
            unique_keys.insert((tile.level, tile.tile_x, tile.tile_y));
        }

        info!(
            "Tile analysis: {} total tiles, {} unique keys, levels: {:?}",
            parsed.tissue_tiles.len(),
            unique_keys.len(),
            level_counts
        );

        // Log first few tiles to see coordinate values
        for (i, tile) in parsed.tissue_tiles.iter().take(10).enumerate() {
            debug!(
                "Tissue tile {}: level={}, x={}, y={}, class_data_len={}, non_zero={}",
                i, tile.level, tile.tile_x, tile.tile_y, tile.class_data.len(),
                tile.class_data.iter().filter(|&&b| b != 255 && b != 0).count()
            );
        }

        // Tissue class colors (8 classes)
        let class_colors: [(u8, u8, u8, u8); 9] = [
            (239, 68, 68, 180),   // 0: Tumor - Red
            (245, 158, 11, 180),  // 1: Stroma - Amber
            (107, 114, 128, 180), // 2: Necrosis - Gray
            (59, 130, 246, 180),  // 3: Lymphocytes - Blue
            (168, 85, 247, 180),  // 4: Mucus - Purple
            (236, 72, 153, 180),  // 5: Smooth Muscle - Pink
            (251, 191, 36, 180),  // 6: Adipose - Yellow
            (229, 231, 235, 100), // 7: Background - Light gray
            (0, 0, 0, 0),         // 255: No data - Transparent
        ];

        for tile in &parsed.tissue_tiles {
            let tile_key = (tile.level, tile.tile_x, tile.tile_y);

            // Resample from source size (224) to target size (256)
            let rgba_data = self.resample_tissue_tile(
                &tile.class_data,
                self.config.source_tile_size,
                self.config.tile_size,
                &class_colors,
            );

            tiles.insert(
                tile_key,
                RasterTile {
                    level: tile.level,
                    x: tile.tile_x,
                    y: tile.tile_y,
                    rgba_data,
                    webp_data: None, // Would encode to WebP in production
                },
            );
        }

        debug!("Derived {} raster tiles", tiles.len());
        tiles
    }

    /// Resample tissue tile from source to target size
    fn resample_tissue_tile(
        &self,
        class_data: &[u8],
        source_size: u32,
        target_size: u32,
        colors: &[(u8, u8, u8, u8); 9],
    ) -> Vec<u8> {
        let target_pixels = (target_size * target_size) as usize;
        let mut rgba = vec![0u8; target_pixels * 4];

        let scale = source_size as f32 / target_size as f32;

        for ty in 0..target_size {
            for tx in 0..target_size {
                // Map target pixel to source pixel (nearest neighbor)
                let sx = ((tx as f32 * scale) as u32).min(source_size - 1);
                let sy = ((ty as f32 * scale) as u32).min(source_size - 1);

                let src_idx = (sy * source_size + sx) as usize;
                let class_id = class_data.get(src_idx).copied().unwrap_or(255);

                // Map class to color
                let color_idx = if class_id == 255 {
                    8
                } else {
                    (class_id as usize).min(7)
                };
                let (r, g, b, a) = colors[color_idx];

                let dst_idx = (ty * target_size + tx) as usize * 4;
                rgba[dst_idx] = r;
                rgba[dst_idx + 1] = g;
                rgba[dst_idx + 2] = b;
                rgba[dst_idx + 3] = a;
            }
        }

        rgba
    }

    /// Derive vector chunks from cell data
    fn derive_vector_chunks(
        &self,
        parsed: &ParsedOverlayData,
    ) -> HashMap<(u32, u32, u32), VectorChunk> {
        let mut chunks: HashMap<(u32, u32, u32), VectorChunk> = HashMap::new();

        // Group cells by tile at level 0 (full resolution)
        for cell in &parsed.cells {
            // Compute actual centroid as midpoint of bounding box
            let cell_centroid_x = (cell.bbox_min_x + cell.bbox_max_x) / 2.0;
            let cell_centroid_y = (cell.bbox_min_y + cell.bbox_max_y) / 2.0;

            // Compute tile coordinates at level 0
            let tile_x = (cell_centroid_x as u32) / self.config.tile_size;
            let tile_y = (cell_centroid_y as u32) / self.config.tile_size;
            let tile_key = (0u32, tile_x, tile_y);

            // Convert cell data to chunk format
            let tile_origin_x = (tile_x * self.config.tile_size) as f32;
            let tile_origin_y = (tile_y * self.config.tile_size) as f32;

            let chunk_cell = ChunkCell {
                class_id: cell.class_id as u8,
                confidence: (cell.confidence * 255.0) as u8,
                centroid_x: (cell_centroid_x - tile_origin_x) as i16,
                centroid_y: (cell_centroid_y - tile_origin_y) as i16,
                vertices: cell.vertices.clone(), // Keep as i32 absolute coordinates
            };

            chunks
                .entry(tile_key)
                .or_insert_with(|| VectorChunk {
                    level: 0,
                    x: tile_x,
                    y: tile_y,
                    cells: Vec::new(),
                    compressed_data: None,
                })
                .cells
                .push(chunk_cell);
        }

        // Limit cells per chunk
        for chunk in chunks.values_mut() {
            if chunk.cells.len() > self.config.max_cells_per_chunk {
                chunk.cells.truncate(self.config.max_cells_per_chunk);
            }
        }

        debug!("Derived {} vector chunks", chunks.len());
        chunks
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay::types::{CellData, ParsedOverlay, TissueTileData};

    fn create_test_parsed_data() -> ParsedOverlayData {
        ParsedOverlayData {
            metadata: ParsedOverlay {
                content_sha256: "test_hash".to_string(),
                slide_id: "test_slide".to_string(),
                model_name: "test_model".to_string(),
                model_version: "1.0".to_string(),
                created_at: 0,
                slide_width: 10000,
                slide_height: 10000,
                tile_size: 256,
                mpp: Some(0.25),
                tissue_classes: vec![],
                cell_classes: vec![],
                total_cells: 2,
                total_tissue_tiles: 1,
            },
            cells: vec![
                CellData {
                    class_id: 0,
                    confidence: 0.9,
                    bbox_min_x: 90.0,
                    bbox_min_y: 90.0,
                    bbox_max_x: 110.0,
                    bbox_max_y: 110.0,
                    vertices: vec![],
                },
                CellData {
                    class_id: 1,
                    confidence: 0.8,
                    bbox_min_x: 490.0,
                    bbox_min_y: 490.0,
                    bbox_max_x: 510.0,
                    bbox_max_y: 510.0,
                    vertices: vec![],
                },
            ],
            tissue_tiles: vec![TissueTileData {
                tile_x: 0,
                tile_y: 0,
                level: 0,
                class_data: vec![0u8; 224 * 224],
                confidence_data: None,
            }],
        }
    }

    #[test]
    fn test_derive_pipeline() {
        let parsed = create_test_parsed_data();
        let pipeline = DerivePipeline::default();
        let derived = pipeline.derive(parsed);

        assert!(!derived.content_sha256.is_empty());
        assert!(!derived.raster_tiles.is_empty());
        assert!(!derived.vector_chunks.is_empty());
    }

    #[test]
    fn test_raster_tile_size() {
        let parsed = create_test_parsed_data();
        let pipeline = DerivePipeline::default();
        let derived = pipeline.derive(parsed);

        for tile in derived.raster_tiles.values() {
            // RGBA = 4 bytes per pixel
            assert_eq!(tile.rgba_data.len(), 256 * 256 * 4);
        }
    }

    #[test]
    fn test_vertices_preserved_for_large_coordinates() {
        // Test that vertices with coordinates > i16::MAX (32767) are correctly preserved
        // This was a bug where vertices were truncated from i32 to i16
        let mut parsed = create_test_parsed_data();

        // Create a cell with large coordinate vertices (simulating a large slide)
        let large_coord: i32 = 50_000; // > 32767 (i16::MAX)
        parsed.cells[0] = CellData {
            class_id: 0,
            confidence: 0.95,
            bbox_min_x: (large_coord - 100) as f32,
            bbox_min_y: (large_coord - 100) as f32,
            bbox_max_x: (large_coord + 100) as f32,
            bbox_max_y: (large_coord + 100) as f32,
            // Polygon vertices in absolute slide coordinates
            vertices: vec![
                large_coord - 50,
                large_coord - 50,
                large_coord + 50,
                large_coord - 50,
                large_coord + 50,
                large_coord + 50,
                large_coord - 50,
                large_coord + 50,
            ],
        };

        let pipeline = DerivePipeline::default();
        let derived = pipeline.derive(parsed);

        // Find the chunk containing our cell
        let cell_tile_x = (large_coord as u32) / 256;
        let cell_tile_y = (large_coord as u32) / 256;
        let chunk_key = (0u32, cell_tile_x, cell_tile_y);

        let chunk = derived.vector_chunks.get(&chunk_key);
        assert!(chunk.is_some(), "Chunk should exist for cell at ({}, {})", cell_tile_x, cell_tile_y);

        let chunk = chunk.unwrap();
        assert!(!chunk.cells.is_empty(), "Chunk should contain cells");

        // Verify vertices are preserved correctly (not truncated)
        let cell = &chunk.cells[0];
        assert_eq!(cell.vertices.len(), 8, "Should have 8 vertex values (4 points × 2 coords)");

        // Each vertex coordinate should be the large value, NOT wrapped/truncated
        for (i, &vertex) in cell.vertices.iter().enumerate() {
            assert!(
                vertex > 32767 || (vertex >= large_coord - 50 && vertex <= large_coord + 50),
                "Vertex {} should not be truncated: got {}, expected around {}",
                i,
                vertex,
                large_coord
            );
        }
    }
}
