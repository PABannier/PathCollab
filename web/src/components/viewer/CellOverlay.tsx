import { memo, useMemo } from 'react'
import type { CellMask, Point } from '../../types/overlay'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface CellOverlayProps {
  cells: CellMask[]
  viewerBounds: DOMRect
  viewport: Viewport
  slideWidth: number
  slideHeight: number
}

const CELL_TYPE_COLORS: Record<string, string> = {
  tumor: 'rgba(220, 38, 38, 0.4)', // red
  lymphocyte: 'rgba(34, 197, 94, 0.4)', // green
  stroma: 'rgba(59, 130, 246, 0.4)', // blue
  default: 'rgba(156, 163, 175, 0.4)', // gray
}

function getCellColor(cellType: string): string {
  return CELL_TYPE_COLORS[cellType.toLowerCase()] ?? CELL_TYPE_COLORS.default
}

export const CellOverlay = memo(function CellOverlay({
  cells,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
}: CellOverlayProps) {
  // Convert slide coordinates to screen coordinates for all cell polygons
  const screenPolygons = useMemo(() => {
    if (viewport.zoom <= 0 || !Number.isFinite(viewport.zoom)) return []
    if (slideWidth <= 0 || slideHeight <= 0) return []
    if (viewerBounds.width <= 0 || viewerBounds.height <= 0) return []

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    const viewportLeft = viewport.centerX - viewportWidth / 2
    const viewportTop = viewport.centerY - viewportHeight / 2

    return cells
      .map((cell) => {
        // Convert polygon coordinates to screen space
        const screenPoints: Point[] = []
        let isVisible = false

        for (const point of cell.coordinates) {
          // Slide coords -> Normalized (0-1)
          const normalizedX = point.x / slideWidth
          const normalizedY = point.y / slideHeight

          // Normalized -> Relative to viewport (0-1 within viewport)
          const relX = (normalizedX - viewportLeft) / viewportWidth
          const relY = (normalizedY - viewportTop) / viewportHeight

          // Check if any point is visible in viewport (with margin)
          if (relX >= -0.1 && relX <= 1.1 && relY >= -0.1 && relY <= 1.1) {
            isVisible = true
          }

          // Relative -> Screen coords
          const screenX = relX * viewerBounds.width
          const screenY = relY * viewerBounds.height

          screenPoints.push({ x: screenX, y: screenY })
        }

        if (!isVisible) return null

        return {
          cell_id: cell.cell_id,
          cell_type: cell.cell_type,
          points: screenPoints,
          color: getCellColor(cell.cell_type),
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  }, [cells, viewerBounds, viewport, slideWidth, slideHeight])

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ width: viewerBounds.width, height: viewerBounds.height }}
    >
      {screenPolygons.map((polygon) => (
        <polygon
          key={polygon.cell_id}
          points={polygon.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={polygon.color}
          stroke={polygon.color.replace('0.4)', '0.8)')}
          strokeWidth={1}
        />
      ))}
    </svg>
  )
})
