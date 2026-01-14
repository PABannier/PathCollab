# Overlay Format Specification

This document defines the overlay format for PathCollab MVP. We use **pre-rendered raster tiles** for simplicity and reliability.

## Overview

Overlays are rendered as pre-computed image tiles that align with the slide coordinate system. This approach:

- Uses standard web technologies (PNG/WebP images)
- Requires no WebGL or complex rendering
- Is easy to debug (tiles are viewable as images)
- Provides predictable performance

## Directory Structure

```
/overlays/{overlay_id}/
    manifest.json          # Metadata and class definitions
    tiles/
        {level}/{x}/{y}.png   # Pre-rendered tiles
```

### Tile Organization

Tiles follow the Deep Zoom Image (DZI) convention:
- Level 0 is the full resolution
- Each subsequent level is half the resolution
- Tiles are 256x256 pixels by default
- Coordinates (x, y) index into the tile grid at each level

Example paths:
```
tiles/0/0/0.png     # Level 0, tile (0,0)
tiles/0/1/0.png     # Level 0, tile (1,0)
tiles/5/3/2.png     # Level 5, tile (3,2)
```

## Manifest Schema

The `manifest.json` file describes the overlay:

```json
{
  "id": "overlay-abc123",
  "slide_id": "demo-slide",
  "name": "Tissue Segmentation",
  "width": 100000,
  "height": 80000,
  "tile_size": 256,
  "levels": 10,
  "format": "png",
  "classes": [
    { "id": 0, "name": "Background", "color": "#000000", "opacity": 0 },
    { "id": 1, "name": "Tumor", "color": "#EF4444", "opacity": 0.7 },
    { "id": 2, "name": "Stroma", "color": "#F59E0B", "opacity": 0.7 },
    { "id": 3, "name": "Necrosis", "color": "#6B7280", "opacity": 0.7 },
    { "id": 4, "name": "Lymphocytes", "color": "#3B82F6", "opacity": 0.7 }
  ],
  "created_at": "2024-01-15T10:30:00Z",
  "version": "1.0"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for this overlay |
| `slide_id` | string | Yes | ID of the associated slide |
| `name` | string | Yes | Human-readable name |
| `width` | integer | Yes | Full resolution width in pixels |
| `height` | integer | Yes | Full resolution height in pixels |
| `tile_size` | integer | Yes | Tile dimensions (default: 256) |
| `levels` | integer | Yes | Number of zoom levels |
| `format` | string | Yes | Image format: "png" or "webp" |
| `classes` | array | Yes | Class definitions for legend |
| `created_at` | string | No | ISO 8601 timestamp |
| `version` | string | No | Schema version |

### Class Definition

Each class in the `classes` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | Yes | Unique class ID (used in tile pixels) |
| `name` | string | Yes | Human-readable class name |
| `color` | string | Yes | Hex color code for UI legend |
| `opacity` | number | No | Default opacity (0-1) |

## Tile Format

Tiles are PNG or WebP images with:
- **Dimensions**: 256x256 pixels (or `tile_size` from manifest)
- **Color depth**: 8-bit indexed color or RGBA
- **Transparency**: Fully transparent for no-data regions

### Encoding Options

1. **Indexed PNG** (recommended):
   - Use palette indices matching class IDs
   - Smaller file size
   - Easier to modify colors client-side

2. **RGBA PNG**:
   - Direct color encoding
   - Larger file size
   - Simpler to create

## API Endpoints

### Get Manifest
```
GET /api/overlay/{overlay_id}/manifest
```

Returns the manifest.json content.

### Get Tile
```
GET /api/overlay/{overlay_id}/tile/{level}/{x}/{y}
```

Returns the PNG/WebP tile image.

## Validation Rules

1. **Manifest Validation**:
   - All required fields present
   - `tile_size` must be power of 2 (typically 256)
   - `levels` must match actual tile directory structure
   - Class IDs must be unique

2. **Tile Validation**:
   - Image dimensions match `tile_size`
   - File format matches `format` field
   - No missing tiles in expected range

## Why Raster Over Vector (MVP Decision)

For the MVP, we chose raster tiles over vector polygons because:

| Aspect | Raster | Vector |
|--------|--------|--------|
| Rendering | Standard img/canvas | Requires WebGL |
| Debugging | Open tile as image | Need specialized tools |
| Coordinate System | Aligned with slide | Transformation required |
| Performance | Predictable | Varies with polygon count |
| Implementation | Simple | Complex |

**Vector support can be added later** once the raster pipeline is stable.

## Future Extensions

- **Vector overlays**: Cell-level polygons with WebGL rendering
- **Multi-layer overlays**: Multiple overlay types on single slide
- **Animated overlays**: Temporal data visualization
- **Custom colormaps**: User-defined color schemes

## Example Usage

```typescript
// Load overlay manifest
const manifest = await fetch(`/api/overlay/${overlayId}/manifest`).then(r => r.json());

// Create OpenSeadragon tile source
const overlayTileSource = {
  width: manifest.width,
  height: manifest.height,
  tileSize: manifest.tile_size,
  maxLevel: manifest.levels - 1,
  getTileUrl: (level, x, y) => `/api/overlay/${overlayId}/tile/${level}/${x}/${y}`,
};

// Add as overlay to viewer
viewer.addTiledImage({
  tileSource: overlayTileSource,
  opacity: 0.7,
});
```
