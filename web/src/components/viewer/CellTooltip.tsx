import { useState, useCallback, useEffect, useMemo } from 'react'

interface CellPolygon {
  x: number  // Absolute slide coordinates
  y: number
  classId: number
  confidence: number
  vertices: number[]
}

interface CellClass {
  id: number
  name: string
  color: string
}

interface CellTooltipProps {
  cells: CellPolygon[]
  cellClasses: CellClass[]
  viewerBounds: DOMRect
  viewport: { centerX: number; centerY: number; zoom: number }
  slideWidth: number
  slideHeight: number
  enabled: boolean
  hoverRadiusPx?: number  // Radius in pixels for hover detection
}

interface TooltipData {
  cell: CellPolygon
  cellClass: CellClass | undefined
  screenX: number
  screenY: number
}

export function CellTooltip({
  cells,
  cellClasses,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
  enabled,
  hoverRadiusPx = 20,
}: CellTooltipProps) {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  // Convert screen coordinates to slide coordinates
  const screenToSlide = useCallback(
    (screenX: number, screenY: number) => {
      // Position relative to viewer
      const relX = (screenX - viewerBounds.left) / viewerBounds.width
      const relY = (screenY - viewerBounds.top) / viewerBounds.height

      // Viewport dimensions in normalized coords
      const vpWidth = 1 / viewport.zoom
      const vpHeight = (viewerBounds.height / viewerBounds.width) / viewport.zoom

      // Convert to slide coordinates
      const slideX = (viewport.centerX - vpWidth / 2 + relX * vpWidth) * slideWidth
      const slideY = (viewport.centerY - vpHeight / 2 + relY * vpHeight) * slideHeight

      return { x: slideX, y: slideY }
    },
    [viewerBounds, viewport, slideWidth, slideHeight]
  )

  // Convert slide coordinates to screen coordinates
  const slideToScreen = useCallback(
    (slideX: number, slideY: number) => {
      const vpWidth = 1 / viewport.zoom
      const vpHeight = (viewerBounds.height / viewerBounds.width) / viewport.zoom

      const normX = slideX / slideWidth
      const normY = slideY / slideHeight

      const relX = (normX - viewport.centerX + vpWidth / 2) / vpWidth
      const relY = (normY - viewport.centerY + vpHeight / 2) / vpHeight

      return {
        x: viewerBounds.left + relX * viewerBounds.width,
        y: viewerBounds.top + relY * viewerBounds.height,
      }
    },
    [viewerBounds, viewport, slideWidth, slideHeight]
  )

  // Build spatial lookup for visible cells
  const visibleCells = useMemo(() => {
    if (!enabled || cells.length === 0) return []

    // Calculate viewport bounds in slide coordinates
    const vpWidth = (1 / viewport.zoom) * slideWidth
    const vpHeight = ((viewerBounds.height / viewerBounds.width) / viewport.zoom) * slideHeight
    const minX = viewport.centerX * slideWidth - vpWidth / 2
    const maxX = viewport.centerX * slideWidth + vpWidth / 2
    const minY = viewport.centerY * slideHeight - vpHeight / 2
    const maxY = viewport.centerY * slideHeight + vpHeight / 2

    // Filter to cells in viewport with some padding
    const padding = vpWidth * 0.1
    return cells.filter(
      (cell) =>
        cell.x >= minX - padding &&
        cell.x <= maxX + padding &&
        cell.y >= minY - padding &&
        cell.y <= maxY + padding
    )
  }, [cells, viewport, viewerBounds, slideWidth, slideHeight, enabled])

  // Find nearest cell to mouse position
  const findNearestCell = useCallback(
    (slideX: number, slideY: number): CellPolygon | null => {
      if (visibleCells.length === 0) return null

      // Calculate threshold in slide coordinates
      const vpWidth = (1 / viewport.zoom) * slideWidth
      const thresholdSlide = (hoverRadiusPx / viewerBounds.width) * vpWidth

      let nearest: CellPolygon | null = null
      let nearestDist = thresholdSlide

      for (const cell of visibleCells) {
        const dx = cell.x - slideX
        const dy = cell.y - slideY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < nearestDist) {
          nearestDist = dist
          nearest = cell
        }
      }

      return nearest
    },
    [visibleCells, viewport, slideWidth, viewerBounds, hoverRadiusPx]
  )

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!enabled) {
        setTooltipData(null)
        return
      }

      setMousePos({ x: e.clientX, y: e.clientY })

      const slideCoords = screenToSlide(e.clientX, e.clientY)
      const nearestCell = findNearestCell(slideCoords.x, slideCoords.y)

      if (nearestCell) {
        const screenPos = slideToScreen(nearestCell.x, nearestCell.y)
        const cellClass = cellClasses.find((c) => c.id === nearestCell.classId)
        setTooltipData({
          cell: nearestCell,
          cellClass,
          screenX: screenPos.x,
          screenY: screenPos.y,
        })
      } else {
        setTooltipData(null)
      }
    },
    [enabled, screenToSlide, findNearestCell, slideToScreen, cellClasses]
  )

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setTooltipData(null)
    setMousePos(null)
  }, [])

  // Attach event listeners
  useEffect(() => {
    if (!enabled) return

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [enabled, handleMouseMove, handleMouseLeave])

  // Clear tooltip when disabled
  useEffect(() => {
    if (!enabled) {
      setTooltipData(null)
    }
  }, [enabled])

  if (!tooltipData || !enabled) return null

  const { cell, cellClass, screenX, screenY } = tooltipData

  return (
    <>
      {/* Highlight ring around hovered cell */}
      <div
        className="pointer-events-none fixed z-50"
        style={{
          left: screenX - 12,
          top: screenY - 12,
          width: 24,
          height: 24,
        }}
      >
        <div
          className="h-full w-full rounded-full border-2 animate-pulse"
          style={{
            borderColor: cellClass?.color || '#fff',
            boxShadow: `0 0 8px ${cellClass?.color || '#fff'}`,
          }}
        />
      </div>

      {/* Tooltip */}
      <div
        className="pointer-events-none fixed z-50 rounded-lg bg-gray-900/95 px-3 py-2 text-sm text-white shadow-xl border border-gray-700"
        style={{
          left: screenX + 16,
          top: screenY - 16,
          maxWidth: 200,
        }}
      >
        {/* Class name with color indicator */}
        <div className="flex items-center gap-2 font-medium">
          <span
            className="h-3 w-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: cellClass?.color || '#9CA3AF' }}
          />
          <span>{cellClass?.name || `Class ${cell.classId}`}</span>
        </div>

        {/* Confidence */}
        <div className="mt-1 text-xs text-gray-400">
          Confidence: {Math.round(cell.confidence * 100)}%
        </div>

        {/* Confidence bar */}
        <div className="mt-1 h-1 w-full bg-gray-700 rounded overflow-hidden">
          <div
            className="h-full transition-all"
            style={{
              width: `${cell.confidence * 100}%`,
              backgroundColor: cellClass?.color || '#9CA3AF',
            }}
          />
        </div>
      </div>
    </>
  )
}
