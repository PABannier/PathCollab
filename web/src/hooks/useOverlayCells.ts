import { useEffect, useState } from 'react'
import type { OverlayManifest } from './useSession'

/** Cell polygon data for rendering */
export interface CellPolygon {
  x: number
  y: number
  classId: number
  confidence: number
  vertices: number[]
}

/** Viewport state with center coordinates and zoom level */
export interface ViewportState {
  centerX: number
  centerY: number
  zoom: number
}

/** Slide dimensions for coordinate calculations */
export interface SlideForOverlay {
  width: number
  height: number
}

export interface UseOverlayCellsOptions {
  /** The overlay ID to fetch cells from (null if no overlay loaded) */
  overlayId: string | null
  /** The overlay manifest containing tile size and level info */
  overlayManifest: OverlayManifest | null
  /** Whether cell overlay is enabled */
  cellsEnabled: boolean
  /** Current viewport state */
  currentViewport: ViewportState
  /** Viewer container bounds for coordinate calculations */
  viewerBounds: DOMRect | null
  /** Current slide info */
  slide: SlideForOverlay | null
}

export interface UseOverlayCellsReturn {
  /** Array of cell polygons for the current viewport */
  overlayCells: CellPolygon[]
}

/**
 * Hook for fetching cell overlay data based on the current viewport.
 *
 * Handles:
 * - Viewport-to-tile coordinate conversion
 * - Debounced fetching (100ms) to avoid excessive requests
 * - AbortController to cancel in-flight requests on viewport changes
 * - Tile range limiting to prevent excessive requests at low zoom
 * - Parallel tile fetching with Promise.all
 */
export function useOverlayCells({
  overlayId,
  overlayManifest,
  cellsEnabled,
  currentViewport,
  viewerBounds,
  slide,
}: UseOverlayCellsOptions): UseOverlayCellsReturn {
  const [overlayCells, setOverlayCells] = useState<CellPolygon[]>([])

  // Fetch overlay cells when viewport changes
  useEffect(() => {
    if (!overlayId || !cellsEnabled || !viewerBounds || !slide) return

    // AbortController to cancel in-flight requests when viewport changes
    const abortController = new AbortController()

    const fetchCells = async () => {
      // Calculate viewport bounds in slide coordinates (pixels)
      const viewportWidth = 1 / currentViewport.zoom
      const viewportHeight = viewerBounds.height / viewerBounds.width / currentViewport.zoom

      const minX = (currentViewport.centerX - viewportWidth / 2) * slide.width
      const maxX = (currentViewport.centerX + viewportWidth / 2) * slide.width
      const minY = (currentViewport.centerY - viewportHeight / 2) * slide.height
      const maxY = (currentViewport.centerY + viewportHeight / 2) * slide.height

      // Server stores vector chunks at level 0 using the overlay tile grid.
      const serverTileSize = overlayManifest?.tile_size ?? 256
      const level = 0

      // Calculate tile range using the server's tile grid
      const maxTileX = Math.max(0, Math.ceil(slide.width / serverTileSize) - 1)
      const maxTileY = Math.max(0, Math.ceil(slide.height / serverTileSize) - 1)
      const startTileX = Math.max(0, Math.floor(minX / serverTileSize))
      const endTileX = Math.min(maxTileX, Math.floor(maxX / serverTileSize))
      const startTileY = Math.max(0, Math.floor(minY / serverTileSize))
      const endTileY = Math.min(maxTileY, Math.floor(maxY / serverTileSize))

      // Fetch vector chunks for visible tiles
      const cells: CellPolygon[] = []
      const fetchPromises: Promise<void>[] = []

      // Limit tile fetches to prevent excessive requests at low zoom
      const maxTilesPerAxis = 4
      const centerTileX = Math.floor((minX + maxX) / 2 / serverTileSize)
      const centerTileY = Math.floor((minY + maxY) / 2 / serverTileSize)
      let rangeStartX = startTileX
      let rangeEndX = endTileX
      let rangeStartY = startTileY
      let rangeEndY = endTileY

      if (endTileX - startTileX + 1 > maxTilesPerAxis) {
        rangeStartX = Math.max(0, centerTileX - Math.floor(maxTilesPerAxis / 2))
        rangeEndX = Math.min(maxTileX, rangeStartX + maxTilesPerAxis - 1)
        rangeStartX = Math.max(0, rangeEndX - maxTilesPerAxis + 1)
      }

      if (endTileY - startTileY + 1 > maxTilesPerAxis) {
        rangeStartY = Math.max(0, centerTileY - Math.floor(maxTilesPerAxis / 2))
        rangeEndY = Math.min(maxTileY, rangeStartY + maxTilesPerAxis - 1)
        rangeStartY = Math.max(0, rangeEndY - maxTilesPerAxis + 1)
      }

      for (let ty = rangeStartY; ty <= rangeEndY; ty++) {
        for (let tx = rangeStartX; tx <= rangeEndX; tx++) {
          // Capture tile coordinates for closure
          const tileX = tx
          const tileY = ty
          // Calculate tile origin in slide coordinates using server's tile size
          const tileOriginX = tileX * serverTileSize
          const tileOriginY = tileY * serverTileSize

          fetchPromises.push(
            fetch(`/api/overlay/${overlayId}/vec/${level}/${tileX}/${tileY}`, {
              signal: abortController.signal,
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.cells) {
                  for (const cell of data.cells) {
                    // Cell x/y are relative to tile origin (in pixels), convert to absolute slide coords
                    cells.push({
                      x: tileOriginX + cell.x,
                      y: tileOriginY + cell.y,
                      classId: cell.class_id,
                      confidence: cell.confidence / 255,
                      vertices: cell.vertices || [],
                    })
                  }
                }
              })
              .catch((err) => {
                // Ignore abort errors - they're expected when viewport changes
                if (err.name !== 'AbortError') {
                  // Silently ignore other fetch errors (network issues, 404s, etc.)
                }
              })
          )
        }
      }

      await Promise.all(fetchPromises)
      // Only update state if the request wasn't aborted
      if (!abortController.signal.aborted) {
        setOverlayCells(cells)
      }
    }

    // Debounce the fetch to avoid too many requests
    const timeoutId = setTimeout(fetchCells, 100)
    return () => {
      clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [overlayId, cellsEnabled, currentViewport, viewerBounds, slide, overlayManifest])

  return {
    overlayCells,
  }
}
