import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionState, Viewport } from './useSession'
import type { SlideViewerHandle } from '../components/viewer'

export interface UseViewerViewportOptions {
  /** Ref to the SlideViewer component for imperative control */
  viewerRef: React.RefObject<SlideViewerHandle | null>
  /** Ref to the viewer container element for measuring bounds */
  viewerContainerRef: React.RefObject<HTMLDivElement | null>
  /** Current session state (null if no session exists) */
  session: SessionState | null
  /** Whether the current user is the presenter */
  isPresenter: boolean
  /** Whether the current user is following the presenter */
  isFollowing: boolean
  /** The presenter's current viewport */
  presenterViewport: Viewport | null
  /** Function to broadcast viewport changes to the session */
  updateViewport: (centerX: number, centerY: number, zoom: number) => void
  /** Function to snap to presenter viewport */
  snapToPresenter: () => void
  /** Function to check if follower has diverged from presenter */
  checkDivergence: (viewport: { centerX: number; centerY: number; zoom: number }) => void
  /** Function to enable/disable follow mode */
  setIsFollowing: (following: boolean) => void
}

export interface UseViewerViewportReturn {
  /** Current viewer container bounds */
  viewerBounds: DOMRect | null
  /** Current viewport state */
  currentViewport: { centerX: number; centerY: number; zoom: number }
  /** Handler for viewport changes from the SlideViewer */
  handleViewportChange: (viewport: { centerX: number; centerY: number; zoom: number }) => void
  /** Handler to snap to presenter viewport */
  handleSnapToPresenter: () => void
  /** Handler to return to presenter (re-enables follow mode and snaps) */
  handleReturnToPresenter: () => void
  /** Handler to reset zoom to default */
  handleZoomReset: () => void
}

/**
 * Hook for managing viewer viewport state and presenter synchronization.
 *
 * Handles:
 * - Tracking viewer container bounds on resize
 * - Viewport state updates with session broadcasting
 * - Presenter viewport following (auto-sync when following)
 * - Snap to presenter functionality
 * - Zoom reset functionality
 */
export function useViewerViewport({
  viewerRef,
  viewerContainerRef,
  session,
  isPresenter,
  isFollowing,
  presenterViewport,
  updateViewport,
  snapToPresenter,
  checkDivergence,
  setIsFollowing,
}: UseViewerViewportOptions): UseViewerViewportReturn {
  const [viewerBounds, setViewerBounds] = useState<DOMRect | null>(null)
  const [currentViewport, setCurrentViewport] = useState({ centerX: 0.5, centerY: 0.5, zoom: 1 })

  // Refs for pending operations
  const pendingSnapRef = useRef(false)
  const lastAppliedViewportRef = useRef<string | null>(null)

  // Update viewer bounds on resize
  useEffect(() => {
    const updateBounds = () => {
      if (viewerContainerRef.current) {
        setViewerBounds(viewerContainerRef.current.getBoundingClientRect())
      }
    }

    updateBounds()
    window.addEventListener('resize', updateBounds)
    return () => window.removeEventListener('resize', updateBounds)
  }, [viewerContainerRef])

  // Apply presenter viewport to the viewer
  const applyPresenterViewport = useCallback(
    (viewport: { center_x: number; center_y: number; zoom: number }) => {
      viewerRef.current?.setViewport({
        centerX: viewport.center_x,
        centerY: viewport.center_y,
        zoom: viewport.zoom,
      })
    },
    [viewerRef]
  )

  // Handle viewport changes from the SlideViewer
  const handleViewportChange = useCallback(
    (viewport: { centerX: number; centerY: number; zoom: number }) => {
      setCurrentViewport(viewport)
      // Check if follower has diverged from presenter
      checkDivergence(viewport)
      // Only send viewport updates if we're in a session
      if (session) {
        updateViewport(viewport.centerX, viewport.centerY, viewport.zoom)
      }
    },
    [session, updateViewport, checkDivergence]
  )

  // Handle snap to presenter
  const handleSnapToPresenter = useCallback(() => {
    pendingSnapRef.current = true
    snapToPresenter()
    if (presenterViewport) {
      applyPresenterViewport(presenterViewport)
    }
  }, [applyPresenterViewport, presenterViewport, snapToPresenter])

  // Handle pending snap when presenterViewport becomes available
  useEffect(() => {
    if (!pendingSnapRef.current || !presenterViewport) return
    applyPresenterViewport(presenterViewport)
    pendingSnapRef.current = false
  }, [applyPresenterViewport, presenterViewport])

  // Auto-follow presenter viewport when following is enabled
  useEffect(() => {
    if (!isFollowing || isPresenter || !presenterViewport) return

    // Create a unique key for this viewport to detect changes
    const viewportKey = `${presenterViewport.center_x}-${presenterViewport.center_y}-${presenterViewport.zoom}-${presenterViewport.timestamp}`

    // Only apply if this is a new viewport (avoid duplicate applications)
    if (lastAppliedViewportRef.current === viewportKey) return
    lastAppliedViewportRef.current = viewportKey

    applyPresenterViewport(presenterViewport)
  }, [isFollowing, isPresenter, presenterViewport, applyPresenterViewport])

  // Handle return to presenter (re-enables follow mode and snaps to presenter)
  const handleReturnToPresenter = useCallback(() => {
    setIsFollowing(true)
    if (presenterViewport) {
      applyPresenterViewport(presenterViewport)
    }
  }, [setIsFollowing, presenterViewport, applyPresenterViewport])

  // Handle zoom reset
  const handleZoomReset = useCallback(() => {
    viewerRef.current?.setViewport({ centerX: 0.5, centerY: 0.5, zoom: 1 })
  }, [viewerRef])

  return {
    viewerBounds,
    currentViewport,
    handleViewportChange,
    handleSnapToPresenter,
    handleReturnToPresenter,
    handleZoomReset,
  }
}
