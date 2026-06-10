import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

/** A cell class as listed in the fovea cell manifest. */
export interface FoveaCellClass {
  id: number
  name: string
}

interface FoveaCellManifest {
  cellCount: number
  classes: FoveaCellClass[]
}

async function fetchCellManifest(slideId: string): Promise<FoveaCellManifest | null> {
  // The forwarder prepares the slide on demand and blocks until ready, so this
  // resolves once the manifest exists (or 404 when the slide has no overlay).
  const response = await fetch(`/api/fovea/${encodeURIComponent(slideId)}/cells/manifest.json`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to fetch cell manifest: ${response.status}`)
  }
  return response.json() as Promise<FoveaCellManifest>
}

export interface UseCellOverlayMetaReturn {
  /** Whether this slide has a cell overlay. */
  hasOverlay: boolean
  /** Whether the manifest is still loading (slide preparation in progress). */
  isOverlayLoading: boolean
  /** Cell-type names for the filter UI. */
  cellTypes: string[]
  /** Cell classes (id + name) used to drive engine colors/visibility. */
  cellClasses: FoveaCellClass[]
  /** Total cell count across the slide. */
  cellCount: number
}

/**
 * Fetches the fovea cell manifest for a slide to drive the cell-type filter UI
 * (names + count) and the engine's per-class colors/visibility. The cell polygons
 * themselves are streamed and rendered by the fovea engine — not fetched here.
 */
export function useCellOverlayMeta(slideId: string | undefined): UseCellOverlayMetaReturn {
  const { data, isLoading } = useQuery({
    queryKey: ['fovea', 'cells', 'manifest', slideId],
    queryFn: () => fetchCellManifest(slideId!),
    enabled: !!slideId,
    staleTime: 5 * 60 * 1000,
  })

  // Stabilize array identities so they only change when the query data changes.
  // Without this, `.map()`/`?? []` allocate fresh arrays every render, which makes
  // Session's "initialize visible cell types" effect ([cellTypes]) fire on every
  // render and reset the user's selection — toggles never stick.
  const cellClasses = useMemo<FoveaCellClass[]>(() => data?.classes ?? [], [data])
  const cellTypes = useMemo(() => cellClasses.map((c) => c.name), [cellClasses])

  return {
    hasOverlay: !!data,
    isOverlayLoading: isLoading,
    cellTypes,
    cellClasses,
    cellCount: data?.cellCount ?? 0,
  }
}
