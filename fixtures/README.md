# Test Fixtures

This directory contains demo slide fixtures for testing.

## Structure

```
fixtures/
├── demo-slide/         # Demo slide for testing
│   ├── slide.dzi       # DZI descriptor (XML)
│   ├── metadata.json   # API metadata format
│   └── tiles/          # Tile images by level
│       ├── 0/          # Level 0 (lowest resolution)
│       ├── 1/          # Level 1
│       └── 2/          # Level 2 (full resolution)
```

## Demo Slide

A 1024x1024 pixel synthetic slide with a colored grid pattern.
- 3 zoom levels
- 256x256 pixel tiles
- DZI format for OpenSeadragon

## Image Format

Tiles are generated as PPM files (portable pixmap). For production use,
convert to JPEG:

```bash
# Using ImageMagick
find fixtures/demo-slide -name '*.ppm' -exec sh -c \
  'convert "$1" "${1%.ppm}.jpeg" && rm "$1"' _ {} \;

# Or using Python with Pillow
pip install Pillow
python3 scripts/convert_fixtures.py
```

## Regenerating Fixtures

To regenerate the fixtures:

```bash
python3 scripts/generate_fixtures.py
```

## Usage in Tests

```typescript
// Load demo slide
const demoSlide = {
  id: 'demo-slide',
  width: 1024,
  height: 1024,
  tileSize: 256,
  numLevels: 3,
  tileUrlTemplate: '/fixtures/demo-slide/tiles/{level}/{x}_{y}.jpeg',
};
```
