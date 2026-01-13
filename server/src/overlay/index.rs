//! Spatial indexing for efficient viewport-based queries
//!
//! Uses a tile-bin approach for fast cell lookup by viewport region.
//! Optionally uses R-tree for precise spatial queries.

use crate::overlay::types::CellData;
use rstar::{RTree, RTreeObject, AABB};
use std::collections::HashMap;
use tracing::debug;

/// Tile coordinates for binning cells
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TileCoord {
    pub level: u32,
    pub x: u32,
    pub y: u32,
}

/// Cell with spatial indexing data
#[derive(Debug, Clone)]
pub struct IndexedCell {
    pub cell_index: usize,
    pub centroid_x: f32,
    pub centroid_y: f32,
    pub class_id: u32,
    pub confidence: f32,
    pub bbox: AABB<[f32; 2]>,
}

impl RTreeObject for IndexedCell {
    type Envelope = AABB<[f32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.bbox
    }
}

/// Tile-bin spatial index for fast viewport queries
pub struct TileBinIndex {
    /// Tile size used for binning
    tile_size: u32,

    /// Number of pyramid levels
    num_levels: u32,

    /// Bins: (level, tile_x, tile_y) -> cell indices
    bins: HashMap<TileCoord, Vec<usize>>,

    /// R-tree for precise spatial queries (optional)
    rtree: Option<RTree<IndexedCell>>,

    /// All indexed cells
    cells: Vec<IndexedCell>,
}

impl TileBinIndex {
    /// Create a new tile-bin index
    pub fn new(tile_size: u32, num_levels: u32) -> Self {
        Self {
            tile_size,
            num_levels,
            bins: HashMap::new(),
            rtree: None,
            cells: Vec::new(),
        }
    }

    /// Build the index from cell data
    pub fn build(&mut self, cells: &[CellData], build_rtree: bool) {
        debug!("Building tile-bin index for {} cells", cells.len());

        self.cells.clear();
        self.bins.clear();

        // Index cells into bins at each level
        for (idx, cell) in cells.iter().enumerate() {
            let indexed = IndexedCell {
                cell_index: idx,
                centroid_x: cell.centroid_x,
                centroid_y: cell.centroid_y,
                class_id: cell.class_id,
                confidence: cell.confidence,
                bbox: AABB::from_corners(
                    [cell.bbox_min_x, cell.bbox_min_y],
                    [cell.bbox_max_x, cell.bbox_max_y],
                ),
            };

            // Add to bins at each pyramid level
            for level in 0..self.num_levels {
                let scale = 1u32 << level;
                let tile_x = (cell.centroid_x as u32) / (self.tile_size * scale);
                let tile_y = (cell.centroid_y as u32) / (self.tile_size * scale);

                let coord = TileCoord {
                    level,
                    x: tile_x,
                    y: tile_y,
                };

                self.bins.entry(coord).or_default().push(idx);
            }

            self.cells.push(indexed);
        }

        // Optionally build R-tree
        if build_rtree && !self.cells.is_empty() {
            debug!("Building R-tree for {} cells", self.cells.len());
            self.rtree = Some(RTree::bulk_load(self.cells.clone()));
        }

        debug!(
            "Index built: {} bins across {} levels",
            self.bins.len(),
            self.num_levels
        );
    }

    /// Query cells in a specific tile
    pub fn query_tile(&self, level: u32, tile_x: u32, tile_y: u32) -> &[usize] {
        let coord = TileCoord {
            level,
            x: tile_x,
            y: tile_y,
        };
        self.bins.get(&coord).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Query cells in a viewport region
    pub fn query_viewport(
        &self,
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
    ) -> Vec<&IndexedCell> {
        if let Some(ref rtree) = self.rtree {
            // Use R-tree for precise query
            let envelope = AABB::from_corners([min_x, min_y], [max_x, max_y]);
            rtree
                .locate_in_envelope_intersecting(&envelope)
                .collect()
        } else {
            // Fallback: linear scan with AABB check
            self.cells
                .iter()
                .filter(|cell| {
                    let bbox = cell.envelope();
                    let [bmin_x, bmin_y] = bbox.lower();
                    let [bmax_x, bmax_y] = bbox.upper();
                    bmax_x >= min_x && bmin_x <= max_x && bmax_y >= min_y && bmin_y <= max_y
                })
                .collect()
        }
    }

    /// Query cells in a viewport with a cell limit (for rendering budgets)
    pub fn query_viewport_limited(
        &self,
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
        limit: usize,
    ) -> Vec<&IndexedCell> {
        if let Some(ref rtree) = self.rtree {
            let envelope = AABB::from_corners([min_x, min_y], [max_x, max_y]);
            rtree
                .locate_in_envelope_intersecting(&envelope)
                .take(limit)
                .collect()
        } else {
            self.cells
                .iter()
                .filter(|cell| {
                    let bbox = cell.envelope();
                    let [bmin_x, bmin_y] = bbox.lower();
                    let [bmax_x, bmax_y] = bbox.upper();
                    bmax_x >= min_x && bmin_x <= max_x && bmax_y >= min_y && bmin_y <= max_y
                })
                .take(limit)
                .collect()
        }
    }

    /// Get all cell indices in a specific tile (for chunk serving)
    pub fn get_tile_cells(&self, level: u32, tile_x: u32, tile_y: u32) -> Vec<usize> {
        self.query_tile(level, tile_x, tile_y).to_vec()
    }

    /// Get statistics about the index
    pub fn stats(&self) -> IndexStats {
        IndexStats {
            total_cells: self.cells.len(),
            num_bins: self.bins.len(),
            num_levels: self.num_levels,
            has_rtree: self.rtree.is_some(),
        }
    }
}

/// Statistics about the spatial index
#[derive(Debug, Clone)]
pub struct IndexStats {
    pub total_cells: usize,
    pub num_bins: usize,
    pub num_levels: u32,
    pub has_rtree: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_cells() -> Vec<CellData> {
        vec![
            CellData {
                centroid_x: 100.0,
                centroid_y: 100.0,
                class_id: 0,
                confidence: 0.9,
                bbox_min_x: 90.0,
                bbox_min_y: 90.0,
                bbox_max_x: 110.0,
                bbox_max_y: 110.0,
                vertices: vec![],
                area: 400.0,
            },
            CellData {
                centroid_x: 500.0,
                centroid_y: 500.0,
                class_id: 1,
                confidence: 0.8,
                bbox_min_x: 490.0,
                bbox_min_y: 490.0,
                bbox_max_x: 510.0,
                bbox_max_y: 510.0,
                vertices: vec![],
                area: 400.0,
            },
        ]
    }

    #[test]
    fn test_index_build() {
        let cells = create_test_cells();
        let mut index = TileBinIndex::new(256, 4);
        index.build(&cells, false);

        let stats = index.stats();
        assert_eq!(stats.total_cells, 2);
        assert!(stats.num_bins > 0);
    }

    #[test]
    fn test_viewport_query() {
        let cells = create_test_cells();
        let mut index = TileBinIndex::new(256, 4);
        index.build(&cells, true);

        // Query should find cell at (100, 100)
        let results = index.query_viewport(0.0, 0.0, 200.0, 200.0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].class_id, 0);

        // Query should find both cells
        let results = index.query_viewport(0.0, 0.0, 600.0, 600.0);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_tile_query() {
        let cells = create_test_cells();
        let mut index = TileBinIndex::new(256, 4);
        index.build(&cells, false);

        // Cell at (100, 100) should be in tile (0, 0) at level 0
        let tile_cells = index.query_tile(0, 0, 0);
        assert_eq!(tile_cells.len(), 1);

        // Cell at (500, 500) should be in tile (1, 1) at level 0
        let tile_cells = index.query_tile(0, 1, 1);
        assert_eq!(tile_cells.len(), 1);
    }
}
