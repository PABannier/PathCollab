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
 * Loads ALL tiles at the current zoom level upfront (not just visible ones)
 * for instant pan/zoom performance. Tiles are cached permanently until slide changes.
 */
export function useTissueOverlay({
  slideId,
  viewport,
  viewerBounds,
  slideWidth,
  enabled,
}: UseTissueOverlayOptions): UseTissueOverlayReturn {
  // Tile cache: key -> CachedTile (persisted across viewport changes and enable/disable)
  const [tiles, setTiles] = useState<Map<string, CachedTile>>(new Map())
  const tilesRef = useRef<Map<string, CachedTile>>(tiles)
  const pendingFetchesRef = useRef<Set<string>>(new Set())

  // Keep ref in sync with state (for use in callbacks without dependency)
  useEffect(() => {
    tilesRef.current = tiles
  }, [tiles])

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

  // Get all tiles at the current level (load everything, not just visible)
  const tilesToLoad = useMemo(() => {
    if (!metadata) {
      return []
    }

    // Return all tiles at the current level - we load everything upfront
    // since tissue tiles are cheap to render and we want instant pan/zoom
    return metadata.tiles.filter((tile) => tile.level === currentLevel)
  }, [metadata, currentLevel])

  // Fetch all tiles at current level (uses ref to avoid recreating callback when tiles change)
  const fetchTiles = useCallback(async () => {
    if (!slideId || !metadata || !enabled || tilesToLoad.length === 0) return

    const tilesToFetch: TissueTileInfo[] = []
    const currentTiles = tilesRef.current

    for (const tile of tilesToLoad) {
      const key = tileKey(tile.level, tile.x, tile.y)
      // Check both the ref (for already cached) and pending fetches
      if (!currentTiles.has(key) && !pendingFetchesRef.current.has(key)) {
        tilesToFetch.push(tile)
        pendingFetchesRef.current.add(key)
      }
    }

    if (tilesToFetch.length === 0) return

    // Fetch tiles in parallel with higher concurrency since tiles are small
    const BATCH_SIZE = 16
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
  }, [slideId, metadata, enabled, tilesToLoad])

  // Fetch all tiles when enabled (no debounce needed since we load everything)
  useEffect(() => {
    if (!enabled || !metadata) return
    fetchTiles()
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
