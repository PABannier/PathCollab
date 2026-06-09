import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { HeatmapOverlayMetadata, TissueTileInfo } from '../types/overlay'
import { TissueTileIndex } from '../utils/TissueTileIndex'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface UseHeatmapOverlayOptions {
  slideId: string | undefined
  heatmapName: string | undefined
  viewport: Viewport
  viewerBounds: DOMRect | null
  slideWidth: number
  slideHeight: number
  enabled: boolean
}

interface HeatmapLoadingResponse {
  slide_id: string
  status: 'loading'
}

type HeatmapMetadataResponse = HeatmapOverlayMetadata | HeatmapLoadingResponse

export interface HeatmapTileBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CachedHeatmapTile {
  level: number
  x: number
  y: number
  width: number
  height: number
  data: Float32Array
  scaleFactor: number
  bounds: HeatmapTileBounds
  loadTime: number
}

interface UseHeatmapOverlayReturn {
  metadata: HeatmapOverlayMetadata | null
  activeHeatmapName: string | null
  tiles: Map<string, CachedHeatmapTile>
  tileIndex: TissueTileIndex | null
  currentLevel: number
  isLoading: boolean
  hasOverlay: boolean
  isOverlayLoading: boolean
}

async function fetchHeatmapMetadata(slideId: string): Promise<HeatmapMetadataResponse | null> {
  const response = await fetch(`/api/slide/${slideId}/overlay/heatmaps/metadata`)

  if (response.status === 404) {
    return null
  }

  if (response.status === 202) {
    return response.json() as Promise<HeatmapLoadingResponse>
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch heatmap metadata: ${response.status}`)
  }

  return response.json() as Promise<HeatmapOverlayMetadata>
}

async function fetchHeatmapTile(
  slideId: string,
  heatmapName: string,
  level: number,
  x: number,
  y: number
): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const encodedName = encodeURIComponent(heatmapName)
  const response = await fetch(
    `/api/slide/${slideId}/overlay/heatmaps/${encodedName}/${level}/${x}/${y}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch heatmap tile: ${response.status}`)
  }

  const width = parseInt(response.headers.get('X-Tile-Width') ?? '256', 10)
  const height = parseInt(response.headers.get('X-Tile-Height') ?? '256', 10)
  const data = await response.arrayBuffer()

  return { data, width, height }
}

function tileKey(heatmapName: string, level: number, x: number, y: number): string {
  return `${heatmapName}-${level}-${x}-${y}`
}

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
  const viewportLeft = (viewport.centerX - viewportWidth / 2) * slideWidth
  const viewportTop = (viewport.centerY - viewportHeight / 2) * slideWidth
  const viewportRight = (viewport.centerX + viewportWidth / 2) * slideWidth
  const viewportBottom = (viewport.centerY + viewportHeight / 2) * slideWidth
  const levelScale = Math.pow(2, maxLevel - level)

  const minX = Math.floor(viewportLeft / levelScale / tileSize)
  const maxX = Math.ceil(viewportRight / levelScale / tileSize)
  const minY = Math.floor(viewportTop / levelScale / tileSize)
  const maxY = Math.ceil(viewportBottom / levelScale / tileSize)

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  }
}

export function useHeatmapOverlay({
  slideId,
  heatmapName,
  viewport,
  viewerBounds,
  slideWidth,
  slideHeight,
  enabled,
}: UseHeatmapOverlayOptions): UseHeatmapOverlayReturn {
  const [tiles, setTiles] = useState<Map<string, CachedHeatmapTile>>(new Map())
  const tilesRef = useRef<Map<string, CachedHeatmapTile>>(tiles)
  const pendingFetchesRef = useRef<Set<string>>(new Set())
  const tileIndexRef = useRef<TissueTileIndex | null>(null)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    tilesRef.current = tiles
  }, [tiles])

  const { data: metadataResponse, isLoading: isLoadingMetadata } = useQuery({
    queryKey: ['overlay', 'heatmaps', 'metadata', slideId],
    queryFn: () => fetchHeatmapMetadata(slideId!),
    enabled: !!slideId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data
      return data && 'status' in data && data.status === 'loading' ? 2000 : false
    },
  })

  const isOverlayLoading =
    metadataResponse != null &&
    'status' in metadataResponse &&
    metadataResponse.status === 'loading'

  const metadata = metadataResponse && !('status' in metadataResponse) ? metadataResponse : null
  const hasOverlay = !!metadata || isOverlayLoading
  const activeHeatmapName = heatmapName ?? metadata?.heatmaps[0]?.name ?? null

  const tileIndex = useMemo(() => {
    if (!metadata || slideWidth <= 0 || slideHeight <= 0) {
      tileIndexRef.current = null
      return null
    }
    const index = new TissueTileIndex(metadata, slideWidth, slideHeight)
    tileIndexRef.current = index
    return index
  }, [metadata, slideWidth, slideHeight, activeHeatmapName])

  useEffect(() => {
    if (!tileIndex) return
    for (const tile of tiles.values()) {
      tileIndex.addTile(tile)
    }
  }, [tiles, tileIndex])

  const availableLevels = useMemo(() => {
    if (!metadata) return new Set<number>()
    return new Set(metadata.tiles.map((tile) => tile.level))
  }, [metadata])

  const currentLevel = useMemo(() => {
    if (!metadata || !viewerBounds || viewport.zoom <= 0 || slideWidth <= 0) {
      return 0
    }

    const viewportWidth = 1 / viewport.zoom
    const pixelsPerViewportPixel = (viewportWidth * slideWidth) / viewerBounds.width
    const levelsDown = Math.max(0, Math.floor(Math.log2(pixelsPerViewportPixel)))
    const idealLevel = Math.max(0, metadata.max_level - levelsDown)

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

  const tilesToLoad = useMemo(() => {
    if (!metadata) return [] as TissueTileInfo[]
    const currentTiles = metadata.tiles.filter((tile) => tile.level === currentLevel)
    const coarseTiles = metadata.tiles.filter((tile) => tile.level < currentLevel)
    return [...coarseTiles, ...currentTiles]
  }, [metadata, currentLevel])

  const fetchTiles = useCallback(async () => {
    if (!slideId || !metadata || !activeHeatmapName || !enabled || !viewerBounds) return
    if (tilesToLoad.length === 0) return

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    const visibleRange = calculateVisibleTileRange(
      viewport,
      viewerBounds,
      slideWidth,
      metadata.tile_size,
      metadata.max_level,
      currentLevel
    )

    const queue = tilesToLoad
      .filter((tile) => {
        const key = tileKey(activeHeatmapName, tile.level, tile.x, tile.y)
        return !tilesRef.current.has(key) && !pendingFetchesRef.current.has(key)
      })
      .sort((a, b) => {
        const levelOrder = a.level - b.level
        if (levelOrder !== 0) return levelOrder
        const da = Math.hypot(a.x - visibleRange.centerX, a.y - visibleRange.centerY)
        const db = Math.hypot(b.x - visibleRange.centerX, b.y - visibleRange.centerY)
        return da - db
      })

    if (queue.length === 0) return

    for (const tile of queue) {
      pendingFetchesRef.current.add(tileKey(activeHeatmapName, tile.level, tile.x, tile.y))
    }

    const maxConcurrentRequests = 50
    let activeRequests = 0
    let queueIndex = 0

    const processNext = async (): Promise<void> => {
      while (queueIndex < queue.length && activeRequests < maxConcurrentRequests) {
        if (abortControllerRef.current?.signal.aborted) return

        const tile = queue[queueIndex++]
        const key = tileKey(activeHeatmapName, tile.level, tile.x, tile.y)

        if (tilesRef.current.has(key)) {
          pendingFetchesRef.current.delete(key)
          continue
        }

        activeRequests++

        fetchHeatmapTile(slideId, activeHeatmapName, tile.level, tile.x, tile.y)
          .then((result) => {
            if (abortControllerRef.current?.signal.aborted) return

            const scaleFactor = Math.pow(2, metadata.max_level - tile.level)
            const tileLeftAtLevel = tile.x * metadata.tile_size
            const tileTopAtLevel = tile.y * metadata.tile_size
            const cachedTile: CachedHeatmapTile = {
              level: tile.level,
              x: tile.x,
              y: tile.y,
              width: result.width,
              height: result.height,
              data: new Float32Array(result.data),
              scaleFactor,
              bounds: {
                left: tileLeftAtLevel * scaleFactor,
                top: tileTopAtLevel * scaleFactor,
                right: tileLeftAtLevel * scaleFactor + result.width * scaleFactor,
                bottom: tileTopAtLevel * scaleFactor + result.height * scaleFactor,
              },
              loadTime: performance.now(),
            }

            setTiles((prev) => {
              const next = new Map(prev)
              next.set(key, cachedTile)
              return next
            })
          })
          .catch((error) => {
            if (error instanceof Error && error.name !== 'AbortError') {
              console.error(`Failed to fetch heatmap tile ${key}:`, error)
            }
          })
          .finally(() => {
            pendingFetchesRef.current.delete(key)
            activeRequests--
            processNext()
          })
      }
    }

    processNext()
  }, [
    slideId,
    metadata,
    activeHeatmapName,
    enabled,
    viewerBounds,
    tilesToLoad,
    viewport,
    slideWidth,
    currentLevel,
  ])

  useEffect(() => {
    if (!enabled || !metadata || !activeHeatmapName) return

    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      fetchTiles()
    } else {
      fetchTimeoutRef.current = setTimeout(fetchTiles, 50)
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [enabled, metadata, activeHeatmapName, fetchTiles])

  useEffect(() => {
    setTiles(new Map())
    pendingFetchesRef.current.clear()
    tileIndexRef.current?.clear()
    abortControllerRef.current?.abort()
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }
    isInitialLoadRef.current = true
  }, [slideId, activeHeatmapName])

  return {
    metadata,
    activeHeatmapName,
    tiles,
    tileIndex,
    currentLevel,
    isLoading: isLoadingMetadata,
    hasOverlay,
    isOverlayLoading,
  }
}
