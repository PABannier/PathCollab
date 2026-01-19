#!/usr/bin/env python3
"""
Generate demo slide fixtures for testing.

This script creates small, synthetic test fixtures that can be included
in the repository for CI testing without external services.

Usage:
    python scripts/generate_fixtures.py

Output:
    fixtures/demo-slide/     - DZI slide with tiles
"""

import json
import math
from pathlib import Path


def create_ppm_image(width: int, height: int, get_pixel) -> bytes:
    """Create a PPM image (simple format, no dependencies)."""
    header = f"P6\n{width} {height}\n255\n".encode('ascii')
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            r, g, b = get_pixel(x, y)
            pixels.extend([r, g, b])
    return header + bytes(pixels)


def generate_demo_slide(output_dir: Path, size: int = 1024, tile_size: int = 256):
    """
    Generate a demo slide with DZI structure.

    Creates a simple colored grid pattern that's visually interesting
    but small enough to include in the repository.
    """
    output_dir = Path(output_dir)
    tiles_dir = output_dir / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating demo slide ({size}x{size} pixels)...")

    # Calculate number of levels
    max_level = math.ceil(math.log2(max(size, size) / tile_size))

    # Create DZI descriptor
    dzi = {
        "Image": {
            "xmlns": "http://schemas.microsoft.com/deepzoom/2008",
            "Format": "jpeg",
            "Overlap": 0,
            "TileSize": tile_size,
            "Size": {
                "Width": size,
                "Height": size
            }
        }
    }

    # Write DZI file
    with open(output_dir / "slide.dzi", "w") as f:
        # DZI is XML format
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write(f'<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" ')
        f.write(f'Format="jpeg" Overlap="0" TileSize="{tile_size}">\n')
        f.write(f'  <Size Width="{size}" Height="{size}"/>\n')
        f.write('</Image>\n')

    print(f"  Created: {output_dir / 'slide.dzi'}")

    # Also create a JSON metadata file for our API
    metadata = {
        "slide_id": "demo-slide",
        "name": "Demo Slide",
        "width": size,
        "height": size,
        "tile_size": tile_size,
        "num_levels": max_level + 1,
        "format": "jpeg"
    }

    with open(output_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"  Created: {output_dir / 'metadata.json'}")

    # Generate tiles at each level
    for level in range(max_level + 1):
        level_dir = tiles_dir / str(level)
        level_dir.mkdir(exist_ok=True)

        # Calculate dimensions at this level
        scale = 2 ** (max_level - level)
        level_width = math.ceil(size / scale)
        level_height = math.ceil(size / scale)

        # Calculate number of tiles
        tiles_x = math.ceil(level_width / tile_size)
        tiles_y = math.ceil(level_height / tile_size)

        for ty in range(tiles_y):
            for tx in range(tiles_x):
                # Calculate tile bounds
                tile_x_start = tx * tile_size
                tile_y_start = ty * tile_size
                tile_width = min(tile_size, level_width - tile_x_start)
                tile_height = min(tile_size, level_height - tile_y_start)

                # Generate colored grid pattern
                def get_pixel(x, y):
                    # Global coordinates in the base image
                    gx = (tile_x_start + x) * scale
                    gy = (tile_y_start + y) * scale

                    # Create a grid pattern with varying colors
                    grid_size = 128
                    cell_x = (gx // grid_size) % 4
                    cell_y = (gy // grid_size) % 4

                    # Color palette
                    colors = [
                        (240, 240, 240),  # Light gray
                        (200, 220, 240),  # Light blue
                        (220, 240, 200),  # Light green
                        (240, 220, 200),  # Light orange
                    ]

                    base = colors[(cell_x + cell_y) % 4]

                    # Add grid lines
                    if gx % grid_size < 2 or gy % grid_size < 2:
                        return (180, 180, 180)

                    return base

                # Create tile image
                ppm_data = create_ppm_image(tile_width, tile_height, get_pixel)

                tile_path = level_dir / f"{tx}_{ty}.ppm"
                with open(tile_path, 'wb') as f:
                    f.write(ppm_data)

        print(f"  Level {level}: {tiles_x}x{tiles_y} tiles ({level_width}x{level_height} px)")

    print(f"Demo slide generated in {output_dir}")


def main():
    """Generate all test fixtures."""
    fixtures_dir = Path(__file__).parent.parent / "fixtures"

    print("=" * 60)
    print("PathCollab Test Fixture Generator")
    print("=" * 60)
    print()

    # Use smaller size for faster generation and smaller files
    slide_size = 1024
    tile_size = 256

    generate_demo_slide(
        fixtures_dir / "demo-slide",
        size=slide_size,
        tile_size=tile_size
    )
    print()

    print("=" * 60)
    print("Fixture generation complete!")
    print()
    print("Note: PPM files were generated. For production use, convert to")
    print("JPEG using ImageMagick or install pillow:")
    print()
    print("  # Convert all PPM to JPEG (slides)")
    print("  find fixtures/demo-slide -name '*.ppm' -exec sh -c \\")
    print("    'convert \"$1\" \"${1%.ppm}.jpeg\"' _ {} \\;")
    print()
    print("=" * 60)


if __name__ == "__main__":
    main()
