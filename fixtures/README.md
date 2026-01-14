# Test Fixtures

This directory contains demo slide and overlay fixtures for testing.

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
│
└── demo-overlay/       # Demo overlay for testing
    ├── manifest.json   # Overlay manifest
    └── tiles/          # Overlay tiles by level
```

## Demo Slide

A 1024x1024 pixel synthetic slide with a colored grid pattern.
- 3 zoom levels
- 256x256 pixel tiles
- DZI format for OpenSeadragon

## Demo Overlay

A 1024x1024 pixel synthetic overlay with concentric regions:
- Background (transparent)
- Tumor (red center)
- Lymphocytes (blue ring)
- Stroma (orange ring)
- Necrosis (gray ring)

## Image Format

Tiles are generated as PPM files (portable pixmap). For production use,
convert to JPEG (slides) or PNG (overlays):

```bash
# Using ImageMagick
find fixtures/demo-slide -name '*.ppm' -exec sh -c \
  'convert "$1" "${1%.ppm}.jpeg" && rm "$1"' _ {} \;

find fixtures/demo-overlay -name '*.ppm' -exec sh -c \
  'convert "$1" "${1%.ppm}.png" && rm "$1"' _ {} \;

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

// Load demo overlay
const manifest = await fetch('/fixtures/demo-overlay/manifest.json').then(r => r.json());
```
