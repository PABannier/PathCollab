import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import type { CellMask, CellsInRegionResponse, OverlayMetadata } from '../types/overlay'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface UseCellOverlayOptions {
  slideId: string | undefined
  viewport: Viewport
  viewerBounds: DOMRect | null
  slideWidth: number
  slideHeight: number
  enabled: boolean
}

interface OverlayLoadingResponse {
  slide_id: string
  status: 'loading'
}

type OverlayMetadataResponse = OverlayMetadata | OverlayLoadingResponse

interface UseCellOverlayReturn {
  cells: CellMask[]
  isLoading: boolean
  hasOverlay: boolean
  isOverlayLoading: boolean
  overlayMetadata: OverlayMetadata | null
}

async function fetchOverlayMetadata(slideId: string): Promise<OverlayMetadataResponse | null> {
  const response = await fetch(`/api/slide/${slideId}/overlay/metadata`)

  if (response.status === 404) {
    return null
  }

  if (response.status === 202) {
    // Loading in progress - return loading response
    return response.json() as Promise<OverlayLoadingResponse>
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch overlay metadata: ${response.status}`)
  }

  return response.json() as Promise<OverlayMetadata>
}

async function fetchCellsInRegion(
  slideId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<CellsInRegionResponse> {
  const params = new URLSearchParams({
    x: Math.floor(x).toString(),
    y: Math.floor(y).toString(),
    width: Math.ceil(width).toString(),
    height: Math.ceil(height).toString(),
  })

  const response = await fetch(`/api/slide/${slideId}/overlay/cells?${params}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch cells: ${response.status}`)
  }

  return response.json()
}

/**
 * Hook to fetch cell overlay data from the backend API.
 * Debounces requests to avoid flooding the API during pan/zoom.
 */
export function useCellOverlay({
  slideId,
  viewport,
  viewerBounds,
  slideWidth,
  slideHeight,
  enabled,
}: UseCellOverlayOptions): UseCellOverlayReturn {
  // Calculate the viewport region in slide pixel coordinates
  // NOTE: OpenSeadragon uses width-normalized coordinates (image width = 1),
  // so both X and Y viewport coords are converted using slideWidth
  const region = useMemo(() => {
    if (!viewerBounds || viewport.zoom <= 0 || slideWidth <= 0 || slideHeight <= 0) {
      return null
    }

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    const x = (viewport.centerX - viewportWidth / 2) * slideWidth
    const y = (viewport.centerY - viewportHeight / 2) * slideWidth
    const width = viewportWidth * slideWidth
    const height = viewportHeight * slideWidth

    return { x, y, width, height }
  }, [viewport, viewerBounds, slideWidth, slideHeight])

  // Debounce the region to avoid rapid refetching during pan/zoom
  const [debouncedRegion, setDebouncedRegion] = useState(region)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRegion(region)
    }, 300)

    return () => clearTimeout(timer)
  }, [region])

  // Query overlay metadata to check if overlay exists
  const { data: metadataResponse, isLoading: isLoadingMetadata } = useQuery({
    queryKey: ['overlay', 'metadata', slideId],
    queryFn: () => fetchOverlayMetadata(slideId!),
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
  const isOverlayLoading = metadataResponse != null && 'status' in metadataResponse && metadataResponse.status === 'loading'

  // Extract actual metadata (null if loading or not found)
  const metadata = metadataResponse && !('status' in metadataResponse) ? metadataResponse : null

  // hasOverlay is true when loading OR when ready
  const hasOverlay = !!metadata || isOverlayLoading

  // Query cells in the current viewport region
  const { data: cellsResponse, isLoading: isLoadingCells } = useQuery({
    queryKey: ['overlay', 'cells', slideId, debouncedRegion],
    queryFn: () =>
      fetchCellsInRegion(
        slideId!,
        debouncedRegion!.x,
        debouncedRegion!.y,
        debouncedRegion!.width,
        debouncedRegion!.height
      ),
    enabled: enabled && hasOverlay && !!slideId && !!debouncedRegion,
    staleTime: 30 * 1000, // Cache cells for 30 seconds
  })

  return {
    cells: cellsResponse?.cells ?? [],
    isLoading: isLoadingMetadata || isLoadingCells,
    hasOverlay,
    isOverlayLoading,
    overlayMetadata: metadata,
  }
}
