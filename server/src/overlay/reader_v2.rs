//! V2 overlay format reader — decodes histotyper_v2 protobuf with zstd-compressed blobs
//! and converts to v1 `SlideSegmentationData` for downstream compatibility.

use std::collections::HashMap;

use super::proto;
use super::proto_v2;
use super::types::OverlayError;

/// Convert a v2 `SlideSegmentationData` into the v1 format used by the rest of the pipeline.
pub fn convert_to_v1(
    v2: &proto_v2::SlideSegmentationData,
) -> Result<proto::SlideSegmentationData, OverlayError> {
    // Build tissue class mapping: index → name
    let tissue_class_mapping: HashMap<i32, String> = v2
        .tissue_class_names
        .iter()
        .enumerate()
        .map(|(i, name)| (i as i32, name.clone()))
        .collect();

    let mut cell_id_offset: i32 = 0;
    let mut tiles = Vec::with_capacity(v2.tiles.len());

    for tile in &v2.tiles {
        let masks = decode_cells_blob(&tile.cells_blob, &v2.cell_class_names, cell_id_offset)?;
        cell_id_offset += masks.len() as i32;

        let tissue_segmentation_map = decode_tissue_blob(&tile.tissue_blob)?;

        tiles.push(proto::TileSegmentationData {
            tile_id: format!("tile_{}_{}", tile.x, tile.y),
            level: v2.level as i32,
            x: tile.x as f32,
            y: tile.y as f32,
            width: v2.tile_size as i32,
            height: v2.tile_size as i32,
            masks,
            tissue_segmentation_map,
        });
    }

    Ok(proto::SlideSegmentationData {
        slide_id: v2.slide_id.clone(),
        slide_path: v2.slide_path.clone(),
        mpp: v2.mpp,
        max_level: v2.max_level as i32,
        cell_model_name: v2.cell_model_name.clone(),
        tissue_model_name: v2.tissue_model_name.clone(),
        tiles,
        tissue_class_mapping,
    })
}

/// Decode a zstd-compressed cells blob into v1 `SegmentationPolygon` messages.
///
/// Binary layout (little-endian):
/// - u16: n_cells
/// - Per cell:
///   - u8: class_id
///   - u8: confidence (0–255, mapped to 0.0–1.0)
///   - i16: centroid_x
///   - i16: centroid_y
///   - u8: n_verts
///   - n_verts × (i16 x, i16 y)
fn decode_cells_blob(
    compressed: &[u8],
    cell_class_names: &[String],
    cell_id_offset: i32,
) -> Result<Vec<proto::SegmentationPolygon>, OverlayError> {
    if compressed.is_empty() {
        return Ok(Vec::new());
    }

    let data = zstd::bulk::decompress(compressed, 64 * 1024 * 1024)
        .map_err(|e| OverlayError::ParseError(format!("zstd decompress cells failed: {}", e)))?;

    if data.len() < 2 {
        return Err(OverlayError::ParseError(
            "cells blob too short for header".into(),
        ));
    }

    let n_cells = u16::from_le_bytes([data[0], data[1]]) as usize;
    let mut pos = 2usize;
    let mut masks = Vec::with_capacity(n_cells);

    for i in 0..n_cells {
        if pos + 5 > data.len() {
            return Err(OverlayError::ParseError(format!(
                "cells blob truncated at cell {}",
                i
            )));
        }

        let class_id = data[pos] as usize;
        let confidence_raw = data[pos + 1];
        let cx = i16::from_le_bytes([data[pos + 2], data[pos + 3]]);
        let cy = i16::from_le_bytes([data[pos + 4], data[pos + 5]]);
        let n_verts = data[pos + 6] as usize;
        pos += 7;

        let bytes_needed = n_verts * 4; // 2 bytes x + 2 bytes y
        if pos + bytes_needed > data.len() {
            return Err(OverlayError::ParseError(format!(
                "cells blob truncated at cell {} vertices",
                i
            )));
        }

        let mut coordinates = Vec::with_capacity(n_verts);
        for _ in 0..n_verts {
            let vx = i16::from_le_bytes([data[pos], data[pos + 1]]);
            let vy = i16::from_le_bytes([data[pos + 2], data[pos + 3]]);
            coordinates.push(proto::segmentation_polygon::Point {
                x: vx as f32,
                y: vy as f32,
            });
            pos += 4;
        }

        let cell_type = cell_class_names
            .get(class_id)
            .cloned()
            .unwrap_or_else(|| format!("unknown_{}", class_id));

        masks.push(proto::SegmentationPolygon {
            cell_id: cell_id_offset + i as i32,
            cell_type,
            confidence: (confidence_raw as f32) / 255.0,
            coordinates,
            centroid: proto::segmentation_polygon::Point {
                x: cx as f32,
                y: cy as f32,
            },
        });
    }

    Ok(masks)
}

/// Decode a zstd-compressed tissue blob into a v1 `TissueSegmentationMap`.
///
/// Binary layout (little-endian):
/// - u16: width
/// - u16: height
/// - width * height × u8: class indices
fn decode_tissue_blob(compressed: &[u8]) -> Result<proto::TissueSegmentationMap, OverlayError> {
    if compressed.is_empty() {
        return Ok(proto::TissueSegmentationMap {
            data: Vec::new(),
            width: 0,
            height: 0,
            dtype: "uint8".into(),
        });
    }

    let data = zstd::bulk::decompress(compressed, 64 * 1024 * 1024)
        .map_err(|e| OverlayError::ParseError(format!("zstd decompress tissue failed: {}", e)))?;

    if data.len() < 4 {
        return Err(OverlayError::ParseError(
            "tissue blob too short for header".into(),
        ));
    }

    let width = u16::from_le_bytes([data[0], data[1]]) as i32;
    let height = u16::from_le_bytes([data[2], data[3]]) as i32;
    let expected = (width as usize) * (height as usize);
    let pixel_data = &data[4..];

    if pixel_data.len() != expected {
        return Err(OverlayError::ParseError(format!(
            "tissue blob size mismatch: expected {}x{}={} bytes, got {}",
            width,
            height,
            expected,
            pixel_data.len()
        )));
    }

    // Store raw (uncompressed) bytes — local.rs::decompress_tissue_data handles this
    Ok(proto::TissueSegmentationMap {
        data: pixel_data.to_vec(),
        width,
        height,
        dtype: "uint8".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cells_blob(cells: &[(u8, u8, i16, i16, &[(i16, i16)])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(cells.len() as u16).to_le_bytes());
        for (class_id, conf, cx, cy, verts) in cells {
            buf.push(*class_id);
            buf.push(*conf);
            buf.extend_from_slice(&cx.to_le_bytes());
            buf.extend_from_slice(&cy.to_le_bytes());
            buf.push(verts.len() as u8);
            for (vx, vy) in *verts {
                buf.extend_from_slice(&vx.to_le_bytes());
                buf.extend_from_slice(&vy.to_le_bytes());
            }
        }
        buf
    }

    fn make_tissue_blob(width: u16, height: u16, pixels: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&width.to_le_bytes());
        buf.extend_from_slice(&height.to_le_bytes());
        buf.extend_from_slice(pixels);
        buf
    }

    #[test]
    fn test_decode_cells_blob_roundtrip() {
        let verts = [(10i16, 20i16), (30, 40), (50, 60)];
        let raw = make_cells_blob(&[(0, 128, 100, 200, &verts)]);
        let compressed = zstd::bulk::compress(&raw, 3).unwrap();

        let class_names = vec!["tumor".to_string(), "stroma".to_string()];
        let masks = decode_cells_blob(&compressed, &class_names, 0).unwrap();

        assert_eq!(masks.len(), 1);
        assert_eq!(masks[0].cell_id, 0);
        assert_eq!(masks[0].cell_type, "tumor");
        assert!((masks[0].confidence - 128.0 / 255.0).abs() < 1e-5);
        assert_eq!(masks[0].centroid.x, 100.0);
        assert_eq!(masks[0].centroid.y, 200.0);
        assert_eq!(masks[0].coordinates.len(), 3);
        assert_eq!(masks[0].coordinates[0].x, 10.0);
        assert_eq!(masks[0].coordinates[0].y, 20.0);
    }

    #[test]
    fn test_decode_cells_blob_empty() {
        let masks = decode_cells_blob(&[], &[], 0).unwrap();
        assert!(masks.is_empty());
    }

    #[test]
    fn test_decode_cells_blob_unknown_class() {
        let raw = make_cells_blob(&[(5, 255, 0, 0, &[])]);
        let compressed = zstd::bulk::compress(&raw, 3).unwrap();

        let class_names = vec!["only_one".to_string()];
        let masks = decode_cells_blob(&compressed, &class_names, 10).unwrap();

        assert_eq!(masks.len(), 1);
        assert_eq!(masks[0].cell_id, 10);
        assert_eq!(masks[0].cell_type, "unknown_5");
    }

    #[test]
    fn test_decode_tissue_blob_roundtrip() {
        let pixels = vec![0u8, 1, 2, 3, 1, 0];
        let raw = make_tissue_blob(3, 2, &pixels);
        let compressed = zstd::bulk::compress(&raw, 3).unwrap();

        let map = decode_tissue_blob(&compressed).unwrap();

        assert_eq!(map.width, 3);
        assert_eq!(map.height, 2);
        assert_eq!(map.data, pixels);
        assert_eq!(map.dtype, "uint8");
    }

    #[test]
    fn test_decode_tissue_blob_empty() {
        let map = decode_tissue_blob(&[]).unwrap();
        assert_eq!(map.width, 0);
        assert_eq!(map.height, 0);
        assert!(map.data.is_empty());
    }

    #[test]
    fn test_convert_to_v1() {
        let verts = [(1i16, 2i16), (3, 4)];
        let cells_raw = make_cells_blob(&[(0, 200, 50, 60, &verts)]);
        let cells_blob = zstd::bulk::compress(&cells_raw, 3).unwrap();

        let tissue_raw = make_tissue_blob(2, 2, &[0, 1, 1, 0]);
        let tissue_blob = zstd::bulk::compress(&tissue_raw, 3).unwrap();

        let v2 = proto_v2::SlideSegmentationData {
            slide_id: "test_slide".into(),
            slide_path: "/path/to/slide".into(),
            mpp: 0.25,
            max_level: 5,
            level: 2,
            tile_size: 256,
            cell_model_name: "cell_model".into(),
            tissue_model_name: "tissue_model".into(),
            cell_class_names: vec!["tumor".into(), "stroma".into()],
            tissue_class_names: vec!["background".into(), "tissue".into()],
            tiles: vec![proto_v2::TileSegmentationData {
                x: 3,
                y: 7,
                cells_blob,
                tissue_blob,
            }],
        };

        let v1 = convert_to_v1(&v2).unwrap();

        assert_eq!(v1.slide_id, "test_slide");
        assert_eq!(v1.mpp, 0.25);
        assert_eq!(v1.max_level, 5);
        assert_eq!(v1.cell_model_name, "cell_model");
        assert_eq!(v1.tissue_model_name, "tissue_model");
        assert_eq!(v1.tissue_class_mapping.len(), 2);
        assert_eq!(v1.tissue_class_mapping[&0], "background");
        assert_eq!(v1.tissue_class_mapping[&1], "tissue");

        assert_eq!(v1.tiles.len(), 1);
        let tile = &v1.tiles[0];
        assert_eq!(tile.tile_id, "tile_3_7");
        assert_eq!(tile.level, 2);
        assert_eq!(tile.x, 3.0);
        assert_eq!(tile.y, 7.0);
        assert_eq!(tile.width, 256);
        assert_eq!(tile.height, 256);
        assert_eq!(tile.masks.len(), 1);
        assert_eq!(tile.masks[0].cell_type, "tumor");
        assert_eq!(tile.tissue_segmentation_map.width, 2);
        assert_eq!(tile.tissue_segmentation_map.height, 2);
    }
}
