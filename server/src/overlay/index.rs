//! Spatial indexing for efficient region queries using R-tree

use rstar::{AABB, RTree, RTreeObject};
use tracing::info;

use super::proto::SlideSegmentationData;
use super::types::{CellMask, Point};

/// Entry in the spatial index containing cell centroid and index into cells vector
#[derive(Debug, Clone)]
pub struct CellEntry {
    /// Index into the cells vector
    pub index: usize,
    /// Centroid coordinates for spatial indexing
    pub centroid: [f32; 2],
}

impl RTreeObject for CellEntry {
    type Envelope = AABB<[f32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_point(self.centroid)
    }
}

/// Spatial index for efficient region queries of cell masks
pub struct OverlaySpatialIndex {
    tree: RTree<CellEntry>,
    cells: Vec<CellMask>,
}

impl OverlaySpatialIndex {
    /// Build a spatial index from protobuf segmentation data
    pub fn from_segmentation_data(data: &SlideSegmentationData) -> Self {
        let mut cells = Vec::new();
        let mut entries = Vec::new();

        if data.tiles.is_empty() {
            return Self {
                tree: RTree::new(),
                cells,
            };
        }

        // Track bounds for debug logging
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = f32::MIN;
        let mut max_y = f32::MIN;

        // Compute scaling factor to resize coordinates (if necessary)
        let tile_level = data.tiles[0].level;
        let max_level = data.max_level;

        let scale_factor = (1 << (max_level - tile_level)) as f32;

        // Iterate over all tiles and extract cell masks
        for tile in &data.tiles {
            // Calculate tile offset in slide pixel coordinates
            let tile_offset_x = tile.x * tile.width as f32;
            let tile_offset_y = tile.y * tile.height as f32;

            for mask in &tile.masks {
                // Add tile offset to centroid
                let centroid = Point {
                    x: (mask.centroid.x + tile_offset_x) * scale_factor,
                    y: (mask.centroid.y + tile_offset_y) * scale_factor,
                };

                // Add tile offset to all polygon coordinates
                let coordinates: Vec<Point> = mask
                    .coordinates
                    .iter()
                    .map(|p| Point {
                        x: (p.x + tile_offset_x) * scale_factor,
                        y: (p.y + tile_offset_y) * scale_factor,
                    })
                    .collect();

                let cell = CellMask {
                    cell_id: mask.cell_id,
                    cell_type: mask.cell_type.clone(),
                    confidence: mask.confidence,
                    coordinates,
                    centroid,
                };

                // Update bounds
                min_x = min_x.min(centroid.x);
                min_y = min_y.min(centroid.y);
                max_x = max_x.max(centroid.x);
                max_y = max_y.max(centroid.y);

                let index = cells.len();
                entries.push(CellEntry {
                    index,
                    centroid: [centroid.x, centroid.y],
                });
                cells.push(cell);
            }
        }

        let tree = RTree::bulk_load(entries);

        if !cells.is_empty() {
            info!(
                "Built spatial index for {} cells, bounds: ({:.0}, {:.0}) to ({:.0}, {:.0})",
                cells.len(),
                min_x,
                min_y,
                max_x,
                max_y
            );
        }

        Self { tree, cells }
    }

    /// Query cells within a rectangular region
    pub fn query_region(&self, x: f64, y: f64, width: f64, height: f64) -> Vec<&CellMask> {
        let lower = [x as f32, y as f32];
        let upper = [(x + width) as f32, (y + height) as f32];
        let envelope = AABB::from_corners(lower, upper);

        self.tree
            .locate_in_envelope(&envelope)
            .map(|entry| &self.cells[entry.index])
            .collect()
    }

    /// Get total number of cells in the index
    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }

    /// Get all unique cell types in the index
    pub fn cell_types(&self) -> Vec<String> {
        let mut types: Vec<String> = self.cells.iter().map(|c| c.cell_type.clone()).collect();
        types.sort();
        types.dedup();
        types
    }
}
