import { useCallback, useEffect, useState } from 'react'
import type { SessionState, Viewport } from '../../hooks/useSession'

export interface UseCursorTrackingOptions {
  /** Current session (null if no active session) */
  session: SessionState | null
  /** Viewer element bounds for coordinate conversion */
  viewerBounds: DOMRect | null
  /** Current viewport state */
  currentViewport: Viewport
  /** Function to convert client coordinates to slide coordinates */
  convertToSlideCoords: (
    clientX: number,
    clientY: number,
    bounds: DOMRect,
    viewport: Viewport
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

  // Start cursor tracking when session is active
  useEffect(() => {
    if (session) {
      startTracking()
    }
    return () => stopTracking()
  }, [session, startTracking, stopTracking])

  // Handle mouse move for cursor tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Always track cursor for footer display when we have bounds
      if (viewerBounds) {
        const slideCoords = convertToSlideCoords(
          e.clientX,
          e.clientY,
          viewerBounds,
          currentViewport
        )
        if (slideCoords) {
          setFooterCursorPos({ x: slideCoords.x, y: slideCoords.y })
          // Only send cursor updates to session if active
          if (session) {
            updateCursorPosition(slideCoords.x, slideCoords.y)
          }
        }
      }
    },
    [session, viewerBounds, currentViewport, convertToSlideCoords, updateCursorPosition]
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
