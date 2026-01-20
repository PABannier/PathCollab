import earcut from 'earcut'
import type { Point } from '../types/overlay'

/**
 * Triangulates a polygon using the earcut algorithm.
 * Returns a flat array of vertex positions (x1, y1, x2, y2, ...) for triangles.
 *
 * @param coordinates - Array of {x, y} points representing the polygon
 * @returns Float32Array of triangulated vertex positions
 */
export function triangulatePolygon(coordinates: Point[]): Float32Array {
  if (coordinates.length < 3) {
    return new Float32Array(0)
  }

  // Flatten coordinates for earcut: [x0, y0, x1, y1, ...]
  const flatCoords: number[] = []
  for (const point of coordinates) {
    flatCoords.push(point.x, point.y)
  }

  // Triangulate using earcut - returns array of indices
  const indices = earcut(flatCoords)

  // Convert indices to actual vertex positions
  const vertices = new Float32Array(indices.length * 2)
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    vertices[i * 2] = flatCoords[idx * 2]
    vertices[i * 2 + 1] = flatCoords[idx * 2 + 1]
  }

  return vertices
}

/**
 * Calculate the screen-space bounding box size for a polygon.
 *
 * @param coordinates - Polygon coordinates in slide space
 * @param slideWidth - Width of the slide
 * @param viewportWidth - Viewport width in normalized coordinates
 * @param viewerWidth - Viewer width in pixels
 * @returns Approximate screen-space size in pixels
 */
export function calculateScreenSize(
  coordinates: Point[],
  slideWidth: number,
  viewportWidth: number,
  viewerWidth: number
): number {
  if (coordinates.length === 0) return 0

  let minX = coordinates[0].x
  let maxX = coordinates[0].x
  let minY = coordinates[0].y
  let maxY = coordinates[0].y

  for (const point of coordinates) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  // Calculate size in slide coordinates
  const slideSize = Math.max(maxX - minX, maxY - minY)

  // Convert to screen size:
  // slideSize / slideWidth gives normalized size
  // (normalized size / viewportWidth) * viewerWidth gives screen pixels
  const normalizedSize = slideSize / slideWidth
  const screenSize = (normalizedSize / viewportWidth) * viewerWidth

  return screenSize
}
