//! Micro-benchmarks for spatial indexing operations
//!
//! These benchmarks test the R-tree spatial index used for overlay cell queries:
//! - Bulk insertion performance
//! - Viewport query performance at various scales
//!
//! Run with: cargo bench --bench spatial_index

use criterion::{BenchmarkId, Criterion, Throughput, black_box, criterion_group, criterion_main};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use rstar::{RTree, RTreeObject, AABB};

/// A cell-like object for the R-tree (matches overlay/index.rs structure)
#[derive(Debug, Clone)]
struct Cell {
    centroid_x: f32,
    centroid_y: f32,
    class_id: u32,
    confidence: f32,
}

impl RTreeObject for Cell {
    type Envelope = AABB<[f32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        // Cells are treated as points for spatial queries
        AABB::from_point([self.centroid_x, self.centroid_y])
    }
}

/// Generate random cells within a given bounding box
fn generate_cells(count: usize, width: f32, height: f32, seed: u64) -> Vec<Cell> {
    let mut rng = StdRng::seed_from_u64(seed);
    (0..count)
        .map(|_| Cell {
            // Use r#gen to escape the reserved keyword in Rust 2024
            centroid_x: rng.r#gen::<f32>() * width,
            centroid_y: rng.r#gen::<f32>() * height,
            class_id: rng.gen_range(0..10),
            confidence: rng.r#gen::<f32>(),
        })
        .collect()
}

fn bench_rtree_construction(c: &mut Criterion) {
    let mut group = c.benchmark_group("rtree_construction");

    // Typical overlay sizes: 10K, 100K, 500K cells
    for count in [10_000, 100_000, 500_000] {
        let cells = generate_cells(count, 100_000.0, 100_000.0, 42);
        group.throughput(Throughput::Elements(count as u64));

        group.bench_with_input(
            BenchmarkId::new("bulk_load", count),
            &cells,
            |b, cells| {
                b.iter(|| RTree::bulk_load(black_box(cells.clone())))
            },
        );
    }

    group.finish();
}

fn bench_viewport_queries(c: &mut Criterion) {
    let mut group = c.benchmark_group("viewport_queries");

    // Build a tree with 100K cells (realistic overlay size)
    let cells = generate_cells(100_000, 100_000.0, 100_000.0, 42);
    let tree = RTree::bulk_load(cells);

    // Query viewports of different sizes (simulating zoom levels)
    let viewport_sizes = [
        ("high_zoom_1k", 1000.0),    // ~1% of slide, high zoom
        ("medium_zoom_10k", 10000.0), // ~10% of slide
        ("low_zoom_50k", 50000.0),    // ~50% of slide, overview
    ];

    for (name, size) in viewport_sizes {
        group.bench_function(name, |b| {
            b.iter(|| {
                let min = [25000.0_f32, 25000.0_f32];
                let max = [25000.0 + size, 25000.0 + size];
                let envelope = AABB::from_corners(min, max);

                let results: Vec<_> = tree.locate_in_envelope(&envelope).collect();
                black_box(results)
            })
        });
    }

    group.finish();
}

fn bench_viewport_with_limit(c: &mut Criterion) {
    let mut group = c.benchmark_group("viewport_with_limit");

    // Build a tree with 100K cells
    let cells = generate_cells(100_000, 100_000.0, 100_000.0, 42);
    let tree = RTree::bulk_load(cells);

    // Simulate the query_viewport_limited function behavior
    // Query a large viewport but limit results
    let limits = [1000, 5000, 10000];

    for limit in limits {
        group.bench_with_input(
            BenchmarkId::new("limit", limit),
            &limit,
            |b, &limit| {
                b.iter(|| {
                    let min = [10000.0_f32, 10000.0_f32];
                    let max = [80000.0_f32, 80000.0_f32];
                    let envelope = AABB::from_corners(min, max);

                    let results: Vec<_> = tree
                        .locate_in_envelope(&envelope)
                        .take(limit)
                        .cloned()
                        .collect();
                    black_box(results)
                })
            },
        );
    }

    group.finish();
}

fn bench_tree_with_different_densities(c: &mut Criterion) {
    let mut group = c.benchmark_group("density_impact");

    // Same number of cells, different densities (different bounding boxes)
    let count = 50_000;

    // Sparse: cells spread over large area
    let sparse = generate_cells(count, 100_000.0, 100_000.0, 42);
    let sparse_tree = RTree::bulk_load(sparse);

    // Dense: cells concentrated in small area
    let dense = generate_cells(count, 10_000.0, 10_000.0, 42);
    let dense_tree = RTree::bulk_load(dense);

    // Query the same relative viewport size (10% of extent)
    group.bench_function("sparse_10pct_viewport", |b| {
        b.iter(|| {
            let envelope = AABB::from_corners([40000.0_f32, 40000.0], [50000.0, 50000.0]);
            let results: Vec<_> = sparse_tree.locate_in_envelope(&envelope).collect();
            black_box(results)
        })
    });

    group.bench_function("dense_10pct_viewport", |b| {
        b.iter(|| {
            let envelope = AABB::from_corners([4000.0_f32, 4000.0], [5000.0, 5000.0]);
            let results: Vec<_> = dense_tree.locate_in_envelope(&envelope).collect();
            black_box(results)
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_rtree_construction,
    bench_viewport_queries,
    bench_viewport_with_limit,
    bench_tree_with_different_densities,
);
criterion_main!(benches);
