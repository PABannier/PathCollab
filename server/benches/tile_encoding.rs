//! Micro-benchmarks for tile encoding operations
//!
//! These benchmarks isolate the CPU-intensive parts of tile serving:
//! - JPEG encoding at various quality levels
//! - Image resizing with different filter types
//! - RGBA to RGB conversion
//!
//! Run with: cargo bench --bench tile_encoding

use criterion::{BenchmarkId, Criterion, Throughput, black_box, criterion_group, criterion_main};
use image::{ImageEncoder, RgbaImage, codecs::jpeg::JpegEncoder};

/// Generate a test image with realistic pathology-like patterns
fn generate_test_image(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);

    // Fill with a pattern that somewhat resembles tissue (pink/purple hues with variation)
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        // Base pink/tissue color with spatial variation
        let base_r = 220u8.saturating_add(((x as f32 * 0.1).sin() * 20.0) as u8);
        let base_g = 180u8.saturating_add(((y as f32 * 0.1).cos() * 30.0) as u8);
        let base_b = 190u8.saturating_add((((x + y) as f32 * 0.05).sin() * 25.0) as u8);

        // Add some "cell-like" darker spots
        let cell_pattern = ((x as f32 * 0.3).sin() * (y as f32 * 0.3).cos() * 50.0) as i16;

        let r = (base_r as i16 - cell_pattern.abs()).clamp(0, 255) as u8;
        let g = (base_g as i16 - cell_pattern.abs()).clamp(0, 255) as u8;
        let b = (base_b as i16 - (cell_pattern.abs() / 2)).clamp(0, 255) as u8;

        *pixel = image::Rgba([r, g, b, 255]);
    }

    img
}

/// Encode RGBA to JPEG (matches production code path)
fn encode_jpeg(rgba: &RgbaImage, quality: u8) -> Vec<u8> {
    let rgb = image::DynamicImage::ImageRgba8(rgba.clone()).into_rgb8();
    let mut buffer = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .expect("JPEG encoding should succeed");
    buffer
}

fn bench_jpeg_encoding(c: &mut Criterion) {
    let mut group = c.benchmark_group("jpeg_encoding");

    // Standard tile size
    let tile_256 = generate_test_image(256, 256);
    group.throughput(Throughput::Elements(1));

    // Benchmark different quality levels
    for quality in [75, 80, 85, 90, 95] {
        group.bench_with_input(
            BenchmarkId::new("256x256", quality),
            &quality,
            |b, &q| {
                b.iter(|| encode_jpeg(black_box(&tile_256), q))
            },
        );
    }

    group.finish();
}

fn bench_tile_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("tile_sizes");

    // Test various tile sizes at quality 85 (production default)
    for size in [128, 256, 512] {
        let img = generate_test_image(size, size);
        group.throughput(Throughput::Bytes((size * size * 4) as u64));

        group.bench_with_input(
            BenchmarkId::new("encode", format!("{}x{}", size, size)),
            &img,
            |b, img| {
                b.iter(|| encode_jpeg(black_box(img), 85))
            },
        );
    }

    group.finish();
}

fn bench_image_resize(c: &mut Criterion) {
    let mut group = c.benchmark_group("image_resize");

    // Simulate reading a larger region and downscaling to tile size
    let source = generate_test_image(512, 512);
    let target_size = 256u32;

    group.throughput(Throughput::Elements(1));

    // Compare resize filter types
    group.bench_function("lanczos3_512_to_256", |b| {
        b.iter(|| {
            image::imageops::resize(
                black_box(&source),
                target_size,
                target_size,
                image::imageops::FilterType::Lanczos3,
            )
        })
    });

    group.bench_function("catmullrom_512_to_256", |b| {
        b.iter(|| {
            image::imageops::resize(
                black_box(&source),
                target_size,
                target_size,
                image::imageops::FilterType::CatmullRom,
            )
        })
    });

    group.bench_function("triangle_512_to_256", |b| {
        b.iter(|| {
            image::imageops::resize(
                black_box(&source),
                target_size,
                target_size,
                image::imageops::FilterType::Triangle,
            )
        })
    });

    group.bench_function("nearest_512_to_256", |b| {
        b.iter(|| {
            image::imageops::resize(
                black_box(&source),
                target_size,
                target_size,
                image::imageops::FilterType::Nearest,
            )
        })
    });

    group.finish();
}

fn bench_rgba_to_rgb_conversion(c: &mut Criterion) {
    let mut group = c.benchmark_group("rgba_to_rgb");

    let rgba_256 = generate_test_image(256, 256);
    group.throughput(Throughput::Bytes((256 * 256 * 4) as u64));

    group.bench_function("256x256", |b| {
        b.iter(|| {
            image::DynamicImage::ImageRgba8(black_box(rgba_256.clone())).into_rgb8()
        })
    });

    group.finish();
}

fn bench_full_tile_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("full_tile_pipeline");
    group.sample_size(50); // Fewer samples for slower benchmarks

    // Simulate the full tile serving pipeline:
    // 1. Start with "raw" RGBA data (simulating OpenSlide read)
    // 2. Resize if needed
    // 3. Convert RGBA to RGB
    // 4. Encode to JPEG

    let source_512 = generate_test_image(512, 512);
    let source_256 = generate_test_image(256, 256);

    group.throughput(Throughput::Elements(1));

    // No resize needed (direct encode)
    group.bench_function("256_direct", |b| {
        b.iter(|| {
            encode_jpeg(black_box(&source_256), 85)
        })
    });

    // With resize (512 -> 256)
    group.bench_function("512_to_256_full", |b| {
        b.iter(|| {
            let resized = image::imageops::resize(
                black_box(&source_512),
                256,
                256,
                image::imageops::FilterType::Lanczos3,
            );
            encode_jpeg(&resized, 85)
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_jpeg_encoding,
    bench_tile_sizes,
    bench_image_resize,
    bench_rgba_to_rgb_conversion,
    bench_full_tile_pipeline,
);
criterion_main!(benches);
