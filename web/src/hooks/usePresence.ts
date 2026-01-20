import { useCallback, useEffect, useRef } from 'react'

interface UsePresenceOptions {
  enabled?: boolean
  cursorUpdateHz?: number
  onCursorUpdate?: (x: number, y: number) => void
  slideWidth: number
  slideHeight: number
}

interface UsePresenceReturn {
  startTracking: () => void
  stopTracking: () => void
  updateCursorPosition: (x: number, y: number) => void
  convertToSlideCoords: (
    clientX: number,
    clientY: number,
    viewerBounds: DOMRect,
    viewport: { centerX: number; centerY: number; zoom: number }
  ) => { x: number; y: number } | null
}

const DEFAULT_CURSOR_UPDATE_HZ = 30

export function usePresence({
  enabled = true,
  cursorUpdateHz = DEFAULT_CURSOR_UPDATE_HZ,
  onCursorUpdate,
  slideWidth,
  slideHeight,
}: UsePresenceOptions): UsePresenceReturn {
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null)
  const trackingRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Store callback and enabled state in refs to avoid stale closures in interval
  const enabledRef = useRef(enabled)
  const onCursorUpdateRef = useRef(onCursorUpdate)

  // Update refs when values change
  useEffect(() => {
    enabledRef.current = enabled
    onCursorUpdateRef.current = onCursorUpdate
  }, [enabled, onCursorUpdate])

  // Convert client coordinates to slide coordinates
  const convertToSlideCoords = useCallback(
    (
      clientX: number,
      clientY: number,
      viewerBounds: DOMRect,
      viewport: { centerX: number; centerY: number; zoom: number }
    ): { x: number; y: number } | null => {
      if (!viewerBounds || viewport.zoom <= 0) return null
      if (viewerBounds.width <= 0 || viewerBounds.height <= 0) return null

      // Calculate position relative to viewer
      const relX = (clientX - viewerBounds.left) / viewerBounds.width
      const relY = (clientY - viewerBounds.top) / viewerBounds.height

      // Convert to slide coordinates based on viewport
      // OpenSeadragon uses normalized coordinates (0-1) for the slide
      const viewportWidth = 1 / viewport.zoom
      const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

      // OpenSeadragon uses width-normalized coordinates (image width = 1),
      // so both X and Y viewport coords are converted using slideWidth
      const slideX = (viewport.centerX - viewportWidth / 2 + relX * viewportWidth) * slideWidth
      const slideY = (viewport.centerY - viewportHeight / 2 + relY * viewportHeight) * slideWidth

      // Clamp to slide bounds
      return {
        x: Math.max(0, Math.min(slideWidth, slideX)),
        y: Math.max(0, Math.min(slideHeight, slideY)),
      }
    },
    [slideWidth, slideHeight]
  )

  // Send cursor update (throttled) - uses refs to always have fresh values
  const sendCursorUpdate = useCallback(() => {
    if (!enabledRef.current || !onCursorUpdateRef.current || !lastCursorRef.current) return

    const { x, y } = lastCursorRef.current
    onCursorUpdateRef.current(x, y)
  }, [])

  // Start tracking cursor
  const startTracking = useCallback(() => {
    if (trackingRef.current) return
    trackingRef.current = true

    // Send cursor updates at specified Hz
    const intervalMs = 1000 / cursorUpdateHz
    intervalRef.current = setInterval(sendCursorUpdate, intervalMs)
  }, [cursorUpdateHz, sendCursorUpdate])

  // Stop tracking cursor
  const stopTracking = useCallback(() => {
    if (!trackingRef.current) return
    trackingRef.current = false

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Update cursor position (call this on mouse move)
  const updateCursorPosition = useCallback((x: number, y: number) => {
    lastCursorRef.current = { x, y }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking()
    }
  }, [stopTracking])

  return {
    startTracking,
    stopTracking,
    updateCursorPosition,
    convertToSlideCoords,
  }
}
