import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionState } from '../../hooks/useSession'

/** Simple viewport type for cursor tracking (without timestamp) */
interface SimpleViewport {
  centerX: number
  centerY: number
  zoom: number
}

export interface UseCursorTrackingOptions {
  /** Current session (null if no active session) */
  session: SessionState | null
  /** Viewer element bounds for coordinate conversion */
  viewerBounds: DOMRect | null
  /** Current viewport state */
  currentViewport: SimpleViewport
  /** Function to convert client coordinates to slide coordinates */
  convertToSlideCoords: (
    clientX: number,
    clientY: number,
    bounds: DOMRect,
    viewport: SimpleViewport
  ) => { x: number; y: number } | null
  /** Function to update cursor position in presence system */
  updateCursorPosition: (x: number, y: number) => void
  /** Start presence tracking */
  startTracking: () => void
  /** Stop presence tracking */
  stopTracking: () => void
}

export interface UseCursorTrackingReturn {
  /** Current cursor position for footer display (null when not over viewer) */
  footerCursorPos: { x: number; y: number } | null
  /** Handler for mouse move events */
  handleMouseMove: (e: React.MouseEvent) => void
  /** Handler for mouse leave events */
  handleMouseLeave: () => void
}

/**
 * Hook for tracking cursor position within the viewer.
 *
 * Handles:
 * - Converting client coordinates to slide coordinates
 * - Updating footer cursor position display
 * - Sending cursor updates to the session (when active)
 * - Starting/stopping presence tracking with session lifecycle
 *
 * Uses refs for frequently-changing values (viewport) to avoid
 * recreating the mousemove handler on every viewport change.
 */
export function useCursorTracking({
  session,
  viewerBounds,
  currentViewport,
  convertToSlideCoords,
  updateCursorPosition,
  startTracking,
  stopTracking,
}: UseCursorTrackingOptions): UseCursorTrackingReturn {
  const [footerCursorPos, setFooterCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Use refs for values that change frequently to avoid stale closures
  // and prevent callback recreation on every viewport/bounds change
  const viewportRef = useRef(currentViewport)
  const boundsRef = useRef(viewerBounds)
  const sessionRef = useRef(session)

  // Keep refs in sync with props
  useEffect(() => {
    viewportRef.current = currentViewport
  }, [currentViewport])

  useEffect(() => {
    boundsRef.current = viewerBounds
  }, [viewerBounds])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Start cursor tracking when session is active
  useEffect(() => {
    if (session) {
      startTracking()
    }
    return () => stopTracking()
  }, [session, startTracking, stopTracking])

  // Handle mouse move for cursor tracking - stable callback
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const bounds = boundsRef.current
      const viewport = viewportRef.current

      // Always track cursor for footer display when we have bounds
      if (bounds) {
        const slideCoords = convertToSlideCoords(e.clientX, e.clientY, bounds, viewport)
        if (slideCoords) {
          setFooterCursorPos({ x: slideCoords.x, y: slideCoords.y })
          // Only send cursor updates to session if active
          if (sessionRef.current) {
            updateCursorPosition(slideCoords.x, slideCoords.y)
          }
        }
      }
    },
    [convertToSlideCoords, updateCursorPosition]
  )

  // Handle mouse leave to clear footer cursor position
  const handleMouseLeave = useCallback(() => {
    setFooterCursorPos(null)
  }, [])

  return {
    footerCursorPos,
    handleMouseMove,
    handleMouseLeave,
  }
}
