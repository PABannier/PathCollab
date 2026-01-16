import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LayerVisibility, SessionState } from './useSession'
import { DEFAULT_CELL_CLASSES, DEFAULT_TISSUE_CLASSES } from '../constants'

export interface UseLayerVisibilityOptions {
  /** Current session state (null if no session exists) */
  session: SessionState | null
  /** Whether the current user is the presenter */
  isPresenter: boolean
  /** Function to broadcast layer visibility changes to all participants */
  updateLayerVisibility: (visibility: LayerVisibility) => void
}

export interface UseLayerVisibilityReturn {
  // Tissue state
  tissueEnabled: boolean
  tissueOpacity: number
  visibleTissueClasses: number[]

  // Cell state
  cellsEnabled: boolean
  cellsOpacity: number
  visibleCellClasses: number[]
  cellHoverEnabled: boolean

  // Computed
  layerVisibility: LayerVisibility
  layerControlsDisabled: boolean

  // Handlers
  handleTissueEnabledChange: (enabled: boolean) => void
  handleTissueOpacityChange: (opacity: number) => void
  handleVisibleTissueClassesChange: (classes: number[]) => void
  handleCellsEnabledChange: (enabled: boolean) => void
  handleCellsOpacityChange: (opacity: number) => void
  handleVisibleCellClassesChange: (classes: number[]) => void
  handleCellHoverEnabledChange: (enabled: boolean) => void
}

/**
 * Hook for managing layer visibility state with bidirectional sync to session.
 *
 * Handles:
 * - Tissue heatmap visibility, opacity, and class filtering
 * - Cell polygon visibility, opacity, and class filtering
 * - Cell hover tooltip toggle
 * - Broadcasting changes to session (presenter only)
 * - Syncing changes from session (followers)
 */
export function useLayerVisibility({
  session,
  isPresenter,
  updateLayerVisibility,
}: UseLayerVisibilityOptions): UseLayerVisibilityReturn {
  // Tissue heatmap state
  const [tissueEnabled, setTissueEnabled] = useState(true)
  const [tissueOpacity, setTissueOpacity] = useState(0.5)
  const [visibleTissueClasses, setVisibleTissueClasses] = useState<number[]>(
    DEFAULT_TISSUE_CLASSES.map((c) => c.id)
  )

  // Cell overlay state
  const [cellsEnabled, setCellsEnabled] = useState(true)
  const [cellsOpacity, setCellsOpacity] = useState(0.7)
  const [visibleCellClasses, setVisibleCellClasses] = useState<number[]>(
    DEFAULT_CELL_CLASSES.map((c) => c.id)
  )
  const [cellHoverEnabled, setCellHoverEnabled] = useState(true)

  // Computed layer visibility object for broadcasting
  const layerVisibility = useMemo<LayerVisibility>(
    () => ({
      tissue_heatmap_visible: tissueEnabled,
      tissue_heatmap_opacity: tissueOpacity,
      tissue_classes_visible: visibleTissueClasses,
      cell_polygons_visible: cellsEnabled,
      cell_polygons_opacity: cellsOpacity,
      cell_classes_visible: visibleCellClasses,
      cell_hover_enabled: cellHoverEnabled,
    }),
    [
      tissueEnabled,
      tissueOpacity,
      visibleTissueClasses,
      cellsEnabled,
      cellsOpacity,
      visibleCellClasses,
      cellHoverEnabled,
    ]
  )

  // Layer controls are disabled for followers
  const layerControlsDisabled = !!session && !isPresenter

  // Emit layer visibility changes to session (presenter only)
  const emitLayerVisibility = useCallback(
    (next: LayerVisibility) => {
      if (session && isPresenter) {
        updateLayerVisibility(next)
      }
    },
    [isPresenter, session, updateLayerVisibility]
  )

  // Tissue handlers
  const handleTissueEnabledChange = useCallback(
    (enabled: boolean) => {
      setTissueEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, tissue_heatmap_visible: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleTissueOpacityChange = useCallback(
    (opacity: number) => {
      setTissueOpacity(opacity)
      emitLayerVisibility({ ...layerVisibility, tissue_heatmap_opacity: opacity })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleVisibleTissueClassesChange = useCallback(
    (classes: number[]) => {
      setVisibleTissueClasses(classes)
      emitLayerVisibility({ ...layerVisibility, tissue_classes_visible: classes })
    },
    [emitLayerVisibility, layerVisibility]
  )

  // Cell handlers
  const handleCellsEnabledChange = useCallback(
    (enabled: boolean) => {
      setCellsEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, cell_polygons_visible: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleCellsOpacityChange = useCallback(
    (opacity: number) => {
      setCellsOpacity(opacity)
      emitLayerVisibility({ ...layerVisibility, cell_polygons_opacity: opacity })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleVisibleCellClassesChange = useCallback(
    (classes: number[]) => {
      setVisibleCellClasses(classes)
      emitLayerVisibility({ ...layerVisibility, cell_classes_visible: classes })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleCellHoverEnabledChange = useCallback(
    (enabled: boolean) => {
      setCellHoverEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, cell_hover_enabled: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  // Apply layer visibility from session (for syncing follower state)
  const arraysEqual = useCallback((a: number[], b: number[]) => {
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
  }, [])

  const applyLayerVisibility = useCallback(
    (visibility: LayerVisibility) => {
      setTissueEnabled((prev) =>
        prev === visibility.tissue_heatmap_visible ? prev : visibility.tissue_heatmap_visible
      )
      setTissueOpacity((prev) =>
        prev === visibility.tissue_heatmap_opacity ? prev : visibility.tissue_heatmap_opacity
      )
      setVisibleTissueClasses((prev) =>
        arraysEqual(prev, visibility.tissue_classes_visible)
          ? prev
          : visibility.tissue_classes_visible
      )
      setCellsEnabled((prev) =>
        prev === visibility.cell_polygons_visible ? prev : visibility.cell_polygons_visible
      )
      setCellsOpacity((prev) =>
        prev === visibility.cell_polygons_opacity ? prev : visibility.cell_polygons_opacity
      )
      setVisibleCellClasses((prev) =>
        arraysEqual(prev, visibility.cell_classes_visible) ? prev : visibility.cell_classes_visible
      )
      setCellHoverEnabled((prev) =>
        prev === visibility.cell_hover_enabled ? prev : visibility.cell_hover_enabled
      )
    },
    [arraysEqual]
  )

  // Sync local layer state with session state from server
  useEffect(() => {
    if (!session?.layer_visibility) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyLayerVisibility(session.layer_visibility)
  }, [applyLayerVisibility, session?.layer_visibility])

  return {
    // Tissue state
    tissueEnabled,
    tissueOpacity,
    visibleTissueClasses,

    // Cell state
    cellsEnabled,
    cellsOpacity,
    visibleCellClasses,
    cellHoverEnabled,

    // Computed
    layerVisibility,
    layerControlsDisabled,

    // Handlers
    handleTissueEnabledChange,
    handleTissueOpacityChange,
    handleVisibleTissueClassesChange,
    handleCellsEnabledChange,
    handleCellsOpacityChange,
    handleVisibleCellClassesChange,
    handleCellHoverEnabledChange,
  }
}
