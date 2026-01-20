import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { TissueOverlayMetadata, TissueTileInfo } from '../types/overlay'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface UseTissueOverlayOptions {
  slideId: string | undefined
  viewport: Viewport
  viewerBounds: DOMRect | null
  slideWidth: number
  slideHeight: number
  enabled: boolean
}

interface TissueLoadingResponse {
  slide_id: string
  status: 'loading'
}

type TissueMetadataResponse = TissueOverlayMetadata | TissueLoadingResponse

/** Cached tile data with its raw bytes */
export interface CachedTile {
  level: number
  x: number
  y: number
  width: number
  height: number
  data: Uint8Array
}

interface UseTissueOverlayReturn {
  metadata: TissueOverlayMetadata | null
  tiles: Map<string, CachedTile>
  currentLevel: number
  isLoading: boolean
  hasOverlay: boolean
  isOverlayLoading: boolean
}

async function fetchTissueMetadata(slideId: string): Promise<TissueMetadataResponse | null> {
  const response = await fetch(`/api/slide/${slideId}/overlay/tissue/metadata`)

  if (response.status === 404) {
    return null
  }

  if (response.status === 202) {
    // Loading in progress - return loading response
    return response.json() as Promise<TissueLoadingResponse>
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch tissue metadata: ${response.status}`)
  }

  return response.json() as Promise<TissueOverlayMetadata>
}

async function fetchTissueTile(
  slideId: string,
  level: number,
  x: number,
  y: number
): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const response = await fetch(`/api/slide/${slideId}/overlay/tissue/${level}/${x}/${y}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch tissue tile: ${response.status}`)
  }

  const width = parseInt(response.headers.get('X-Tile-Width') ?? '256', 10)
  const height = parseInt(response.headers.get('X-Tile-Height') ?? '256', 10)
  const data = await response.arrayBuffer()

  return { data, width, height }
}

/** Generate tile key for caching */
function tileKey(level: number, x: number, y: number): string {
  return `${level}-${x}-${y}`
}

/**
 * Hook to fetch tissue overlay data from the backend API.
 * Fetches tiles for the visible viewport and caches them in-memory.
 */
export function useTissueOverlay({
  slideId,
  viewport,
  viewerBounds,
  slideWidth,
  slideHeight,
  enabled,
}: UseTissueOverlayOptions): UseTissueOverlayReturn {
  // Tile cache: key -> CachedTile
  const [tiles, setTiles] = useState<Map<string, CachedTile>>(new Map())
  const pendingFetchesRef = useRef<Set<string>>(new Set())

  // Query tissue metadata to check if overlay exists
  const { data: metadataResponse, isLoading: isLoadingMetadata } = useQuery({
    queryKey: ['overlay', 'tissue', 'metadata', slideId],
    queryFn: () => fetchTissueMetadata(slideId!),
    enabled: !!slideId,
    staleTime: 5 * 60 * 1000, // Cache metadata for 5 minutes
    // Poll every 2 seconds while loading
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && 'status' in data && data.status === 'loading') {
        return 2000
      }
      return false
    },
  })

  // Check if overlay is in loading state
  const isOverlayLoading =
    metadataResponse != null &&
    'status' in metadataResponse &&
    metadataResponse.status === 'loading'

  // Extract actual metadata (null if loading or not found)
  const metadata = metadataResponse && !('status' in metadataResponse) ? metadataResponse : null

  // hasOverlay is true when loading OR when ready
  const hasOverlay = !!metadata || isOverlayLoading

  // Build set of available levels from metadata
  const availableLevels = useMemo(() => {
    if (!metadata) return new Set<number>()
    const levels = new Set<number>()
    for (const tile of metadata.tiles) {
      levels.add(tile.level)
    }
    return levels
  }, [metadata])

  // Calculate the target level based on viewport zoom
  const currentLevel = useMemo(() => {
    if (!metadata || !viewerBounds || viewport.zoom <= 0 || slideWidth <= 0) {
      return 0
    }

    // Determine the ideal level to use based on zoom
    // Use lower level (more detail) when zoomed in, higher level (less detail) when zoomed out
    const viewportWidth = 1 / viewport.zoom
    const pixelsPerViewportPixel = (viewportWidth * slideWidth) / viewerBounds.width
    const idealLevel = Math.max(
      0,
      Math.min(metadata.max_level, Math.floor(Math.log2(pixelsPerViewportPixel)))
    )

    // Find the closest available level to the ideal level
    let closestLevel = 0
    let closestDistance = Infinity
    for (const level of availableLevels) {
      const distance = Math.abs(level - idealLevel)
      if (distance < closestDistance) {
        closestDistance = distance
        closestLevel = level
      }
    }

    return closestLevel
  }, [metadata, viewport.zoom, viewerBounds, slideWidth, availableLevels])

  // Calculate visible tiles based on viewport
  const visibleTiles = useMemo(() => {
    if (!metadata || !viewerBounds || viewport.zoom <= 0 || slideWidth <= 0 || slideHeight <= 0) {
      return []
    }

    // Convert viewport to slide pixel coordinates (full resolution)
    // OpenSeadragon uses width-normalized coordinates
    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    const viewLeft = (viewport.centerX - viewportWidth / 2) * slideWidth
    const viewTop = (viewport.centerY - viewportHeight / 2) * slideWidth
    const viewRight = (viewport.centerX + viewportWidth / 2) * slideWidth
    const viewBottom = (viewport.centerY + viewportHeight / 2) * slideWidth

    // Find tiles that intersect with the viewport at the current level
    const visibleTileInfos: TissueTileInfo[] = []

    // The protobuf uses inverted level convention: maxLevel = full resolution
    // levelScale converts from tile's level to full resolution
    const levelScale = Math.pow(2, metadata.max_level - currentLevel)

    for (const tile of metadata.tiles) {
      if (tile.level !== currentLevel) continue

      // Tile x, y are GRID indices (column, row), not pixel coordinates
      // First convert to pixel coordinates at the tile's level, then scale to full resolution
      const tileLeftAtLevel = tile.x * metadata.tile_size
      const tileTopAtLevel = tile.y * metadata.tile_size

      // Convert to full resolution coordinates
      const tileLeft = tileLeftAtLevel * levelScale
      const tileTop = tileTopAtLevel * levelScale
      const tileRight = tileLeft + tile.width * levelScale
      const tileBottom = tileTop + tile.height * levelScale

      // Check intersection with some padding to prefetch nearby tiles
      const padding = metadata.tile_size * levelScale * 0.5
      if (
        tileRight + padding > viewLeft &&
        tileLeft - padding < viewRight &&
        tileBottom + padding > viewTop &&
        tileTop - padding < viewBottom
      ) {
        visibleTileInfos.push(tile)
      }
    }

    // Sort tiles by distance from viewport center for priority loading
    const viewCenterX = (viewLeft + viewRight) / 2
    const viewCenterY = (viewTop + viewBottom) / 2

    visibleTileInfos.sort((a, b) => {
      const aX = (a.x * metadata.tile_size + a.width / 2) * levelScale
      const aY = (a.y * metadata.tile_size + a.height / 2) * levelScale
      const bX = (b.x * metadata.tile_size + b.width / 2) * levelScale
      const bY = (b.y * metadata.tile_size + b.height / 2) * levelScale

      const aDist = Math.abs(aX - viewCenterX) + Math.abs(aY - viewCenterY)
      const bDist = Math.abs(bX - viewCenterX) + Math.abs(bY - viewCenterY)
      return aDist - bDist
    })

    // Limit to reasonable number of tiles to avoid overwhelming fetches
    const MAX_VISIBLE_TILES = 100
    return visibleTileInfos.slice(0, MAX_VISIBLE_TILES)
  }, [metadata, viewport, viewerBounds, slideWidth, slideHeight, currentLevel])

  // Fetch visible tiles
  const fetchTiles = useCallback(async () => {
    if (!slideId || !metadata || !enabled || visibleTiles.length === 0) return

    const tilesToFetch: TissueTileInfo[] = []

    for (const tile of visibleTiles) {
      const key = tileKey(tile.level, tile.x, tile.y)
      if (!tiles.has(key) && !pendingFetchesRef.current.has(key)) {
        tilesToFetch.push(tile)
        pendingFetchesRef.current.add(key)
      }
    }

    if (tilesToFetch.length === 0) return

    // Fetch tiles in parallel (limit concurrency to avoid overwhelming the server)
    const BATCH_SIZE = 4
    for (let i = 0; i < tilesToFetch.length; i += BATCH_SIZE) {
      const batch = tilesToFetch.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (tile) => {
          const key = tileKey(tile.level, tile.x, tile.y)
          try {
            const result = await fetchTissueTile(slideId, tile.level, tile.x, tile.y)
            const cachedTile: CachedTile = {
              level: tile.level,
              x: tile.x,
              y: tile.y,
              width: result.width,
              height: result.height,
              data: new Uint8Array(result.data),
            }

            setTiles((prev) => {
              const next = new Map(prev)
              next.set(key, cachedTile)
              return next
            })
          } catch (error) {
            console.error(`Failed to fetch tissue tile ${key}:`, error)
          } finally {
            pendingFetchesRef.current.delete(key)
          }
        })
      )
    }
  }, [slideId, metadata, enabled, visibleTiles, tiles])

  // Debounce tile fetching
  useEffect(() => {
    if (!enabled || !metadata) return

    const timer = setTimeout(() => {
      fetchTiles()
    }, 150) // Small debounce to batch requests during rapid viewport changes

    return () => clearTimeout(timer)
  }, [enabled, metadata, fetchTiles])

  // Clear tile cache when slide changes
  useEffect(() => {
    setTiles(new Map())
    pendingFetchesRef.current.clear()
  }, [slideId])

  return {
    metadata,
    tiles,
    currentLevel,
    isLoading: isLoadingMetadata,
    hasOverlay,
    isOverlayLoading,
  }
}
