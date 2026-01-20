import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { TissueOverlayMetadata, TissueTileInfo } from '../types/overlay'
import { TissueTileIndex } from '../utils/TissueTileIndex'

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

/** Pre-computed bounds for a tile in full resolution coordinates */
export interface TileBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** Cached tile data with its raw bytes and pre-computed rendering values */
export interface CachedTile {
  level: number
  x: number
  y: number
  width: number
  height: number
  data: Uint8Array
  // Pre-computed values for rendering
  scaleFactor: number // Math.pow(2, maxLevel - level)
  bounds: TileBounds // Bounds in full resolution slide coordinates
}

interface UseTissueOverlayReturn {
  metadata: TissueOverlayMetadata | null
  tiles: Map<string, CachedTile>
  tileIndex: TissueTileIndex | null
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

/** Tile priority levels for load ordering */
const TilePriority = {
  URGENT: 0, // Visible tile with no fallback available
  VISIBLE: 1, // Visible tile but has fallback from coarser level
  PREFETCH: 2, // Outside viewport but within margin for prefetching
} as const

type TilePriorityType = (typeof TilePriority)[keyof typeof TilePriority]

/** Tile with priority and distance for sorting */
interface PrioritizedTile {
  tile: TissueTileInfo
  priority: TilePriorityType
  distance: number // Distance from viewport center
}

/** Batch sizes per priority level */
const BATCH_SIZES: Record<TilePriorityType, number> = {
  [TilePriority.URGENT]: 8,
  [TilePriority.VISIBLE]: 12,
  [TilePriority.PREFETCH]: 16,
}

/** Calculate viewport bounds in tile grid coordinates */
function calculateVisibleTileRange(
  viewport: Viewport,
  viewerBounds: DOMRect,
  slideWidth: number,
  tileSize: number,
  maxLevel: number,
  level: number
): { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number } {
  const viewportWidth = 1 / viewport.zoom
  const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

  // Convert normalized viewport to slide pixel coords
  const viewportLeft = (viewport.centerX - viewportWidth / 2) * slideWidth
  const viewportTop = (viewport.centerY - viewportHeight / 2) * slideWidth
  const viewportRight = (viewport.centerX + viewportWidth / 2) * slideWidth
  const viewportBottom = (viewport.centerY + viewportHeight / 2) * slideWidth

  // Scale to tile's level (coarser levels have smaller pixel dimensions)
  const levelScale = Math.pow(2, maxLevel - level)
  const viewportLeftAtLevel = viewportLeft / levelScale
  const viewportTopAtLevel = viewportTop / levelScale
  const viewportRightAtLevel = viewportRight / levelScale
  const viewportBottomAtLevel = viewportBottom / levelScale

  // Convert to tile grid coordinates
  const minX = Math.floor(viewportLeftAtLevel / tileSize)
  const maxX = Math.ceil(viewportRightAtLevel / tileSize)
  const minY = Math.floor(viewportTopAtLevel / tileSize)
  const maxY = Math.ceil(viewportBottomAtLevel / tileSize)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  return { minX, maxX, minY, maxY, centerX, centerY }
}

/** Prioritize tiles based on visibility and fallback availability */
function prioritizeTiles(
  tilesToFetch: TissueTileInfo[],
  visibleRange: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    centerX: number
    centerY: number
  },
  tileIndex: TissueTileIndex | null,
  metadata: TissueOverlayMetadata
): PrioritizedTile[] {
  const MARGIN = 1 // One tile margin for prefetching

  return tilesToFetch.map((tile) => {
    // Calculate distance from viewport center
    const distance = Math.sqrt(
      Math.pow(tile.x - visibleRange.centerX, 2) + Math.pow(tile.y - visibleRange.centerY, 2)
    )

    // Determine if tile is visible
    const isVisible =
      tile.x >= visibleRange.minX &&
      tile.x <= visibleRange.maxX &&
      tile.y >= visibleRange.minY &&
      tile.y <= visibleRange.maxY

    // Determine if tile is in prefetch margin
    const isInMargin =
      tile.x >= visibleRange.minX - MARGIN &&
      tile.x <= visibleRange.maxX + MARGIN &&
      tile.y >= visibleRange.minY - MARGIN &&
      tile.y <= visibleRange.maxY + MARGIN

    let priority: TilePriorityType

    if (isVisible) {
      // Check if we have a fallback tile for this position
      const scaleFactor = Math.pow(2, metadata.max_level - tile.level)
      const bounds: TileBounds = {
        left: tile.x * metadata.tile_size * scaleFactor,
        top: tile.y * metadata.tile_size * scaleFactor,
        right: (tile.x + 1) * metadata.tile_size * scaleFactor,
        bottom: (tile.y + 1) * metadata.tile_size * scaleFactor,
      }
      const hasFallback = tileIndex?.findFallback(tile.level, tile.x, tile.y, bounds) !== null
      priority = hasFallback ? TilePriority.VISIBLE : TilePriority.URGENT
    } else if (isInMargin) {
      priority = TilePriority.PREFETCH
    } else {
      priority = TilePriority.PREFETCH
    }

    return { tile, priority, distance }
  })
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
  slideHeight,
  enabled,
}: UseTissueOverlayOptions): UseTissueOverlayReturn {
  // Tile cache: key -> CachedTile (persisted across viewport changes and enable/disable)
  const [tiles, setTiles] = useState<Map<string, CachedTile>>(new Map())
  const tilesRef = useRef<Map<string, CachedTile>>(tiles)
  const pendingFetchesRef = useRef<Set<string>>(new Set())
  const tileIndexRef = useRef<TissueTileIndex | null>(null)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  // Create or update tile index when metadata changes
  const tileIndex = useMemo(() => {
    if (!metadata || slideWidth <= 0 || slideHeight <= 0) {
      tileIndexRef.current = null
      return null
    }
    // Create new index for this metadata
    const index = new TissueTileIndex(metadata, slideWidth, slideHeight)
    tileIndexRef.current = index
    return index
  }, [metadata, slideWidth, slideHeight])

  // Add tiles to index when they load
  useEffect(() => {
    if (!tileIndex) return
    for (const tile of tiles.values()) {
      tileIndex.addTile(tile)
    }
  }, [tiles, tileIndex])

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
    const viewportWidth = 1 / viewport.zoom
    const pixelsPerViewportPixel = (viewportWidth * slideWidth) / viewerBounds.width
    // Calculate how many levels down from max we should go based on the zoom
    const levelsDown = Math.max(0, Math.floor(Math.log2(pixelsPerViewportPixel)))
    const idealLevel = Math.max(0, metadata.max_level - levelsDown)

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

  // Fetch all tiles at current level with priority-based ordering
  const fetchTiles = useCallback(async () => {
    if (!slideId || !metadata || !enabled || tilesToLoad.length === 0 || !viewerBounds) return

    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    const tilesToFetch: TissueTileInfo[] = []
    const currentTiles = tilesRef.current

    for (const tile of tilesToLoad) {
      const key = tileKey(tile.level, tile.x, tile.y)
      // Check both the ref (for already cached) and pending fetches
      if (!currentTiles.has(key) && !pendingFetchesRef.current.has(key)) {
        tilesToFetch.push(tile)
      }
    }

    if (tilesToFetch.length === 0) return

    // Calculate visible tile range for prioritization
    const visibleRange = calculateVisibleTileRange(
      viewport,
      viewerBounds,
      slideWidth,
      metadata.tile_size,
      metadata.max_level,
      currentLevel
    )

    // Prioritize tiles based on visibility and fallback availability
    const prioritizedTiles = prioritizeTiles(tilesToFetch, visibleRange, tileIndex, metadata)

    // Sort by priority first, then by distance from center
    prioritizedTiles.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return a.distance - b.distance
    })

    // Mark all tiles as pending
    for (const { tile } of prioritizedTiles) {
      pendingFetchesRef.current.add(tileKey(tile.level, tile.x, tile.y))
    }

    // Fetch tiles in batches based on priority
    let index = 0
    while (index < prioritizedTiles.length) {
      // Check if aborted
      if (abortControllerRef.current?.signal.aborted) break

      // Determine batch size based on current priority
      const currentPriority = prioritizedTiles[index].priority
      const batchSize = BATCH_SIZES[currentPriority]

      // Get batch of tiles with same or higher priority
      const batch: TissueTileInfo[] = []
      while (index < prioritizedTiles.length && batch.length < batchSize) {
        batch.push(prioritizedTiles[index].tile)
        index++
      }

      // Fetch batch in parallel
      await Promise.all(
        batch.map(async (tile) => {
          const key = tileKey(tile.level, tile.x, tile.y)

          // Skip if already loaded (race condition check)
          if (tilesRef.current.has(key)) {
            pendingFetchesRef.current.delete(key)
            return
          }

          try {
            const result = await fetchTissueTile(slideId, tile.level, tile.x, tile.y)

            // Check if aborted before processing result
            if (abortControllerRef.current?.signal.aborted) return

            // Pre-compute scale factor and bounds for this tile
            const scaleFactor = Math.pow(2, metadata.max_level - tile.level)
            const tileLeftAtLevel = tile.x * metadata.tile_size
            const tileTopAtLevel = tile.y * metadata.tile_size
            const bounds: TileBounds = {
              left: tileLeftAtLevel * scaleFactor,
              top: tileTopAtLevel * scaleFactor,
              right: tileLeftAtLevel * scaleFactor + result.width * scaleFactor,
              bottom: tileTopAtLevel * scaleFactor + result.height * scaleFactor,
            }

            const cachedTile: CachedTile = {
              level: tile.level,
              x: tile.x,
              y: tile.y,
              width: result.width,
              height: result.height,
              data: new Uint8Array(result.data),
              scaleFactor,
              bounds,
            }

            setTiles((prev) => {
              const next = new Map(prev)
              next.set(key, cachedTile)
              return next
            })
          } catch (error) {
            // Ignore abort errors
            if (error instanceof Error && error.name !== 'AbortError') {
              console.error(`Failed to fetch tissue tile ${key}:`, error)
            }
          } finally {
            pendingFetchesRef.current.delete(key)
          }
        })
      )
    }
  }, [
    slideId,
    metadata,
    enabled,
    tilesToLoad,
    viewport,
    viewerBounds,
    slideWidth,
    currentLevel,
    tileIndex,
  ])

  // Fetch tiles with 150ms debounce on viewport changes
  useEffect(() => {
    if (!enabled || !metadata) return

    // Clear any pending timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    // Debounce tile fetching to avoid excessive requests during pan/zoom
    fetchTimeoutRef.current = setTimeout(() => {
      fetchTiles()
    }, 150)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [enabled, metadata, fetchTiles])

  // Clear tile cache when slide changes
  useEffect(() => {
    setTiles(new Map())
    pendingFetchesRef.current.clear()
    if (tileIndexRef.current) {
      tileIndexRef.current.clear()
    }
    // Cancel any ongoing fetches
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }
  }, [slideId])

  return {
    metadata,
    tiles,
    tileIndex,
    currentLevel,
    isLoading: isLoadingMetadata,
    hasOverlay,
    isOverlayLoading,
  }
}
