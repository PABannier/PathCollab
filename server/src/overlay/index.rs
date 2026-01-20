//! Spatial indexing for efficient region queries using R-tree

use rstar::{AABB, RTree, RTreeObject};

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

        // Iterate over all tiles and extract cell masks
        for tile in &data.tiles {
            for mask in &tile.masks {
                // Access centroid directly (required field in proto)
                let centroid = Point {
                    x: mask.centroid.x,
                    y: mask.centroid.y,
                };

                let coordinates: Vec<Point> = mask
                    .coordinates
                    .iter()
                    .map(|p| Point { x: p.x, y: p.y })
                    .collect();

                let cell = CellMask {
                    cell_id: mask.cell_id,
                    cell_type: mask.cell_type.clone(),
                    confidence: mask.confidence,
                    coordinates,
                    centroid,
                };

                let index = cells.len();
                entries.push(CellEntry {
                    index,
                    centroid: [centroid.x, centroid.y],
                });
                cells.push(cell);
            }
        }

        let tree = RTree::bulk_load(entries);

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
