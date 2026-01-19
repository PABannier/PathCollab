import { memo, useMemo } from 'react'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface Participant {
  id: string
  name: string
  color: string
}

interface MinimapOverlayProps {
  // Presenter viewport (shown to followers)
  presenterViewport: Viewport | null
  presenterInfo?: Participant | null
  // Current user's viewport
  currentViewport: Viewport
  // Minimap size in pixels
  minimapWidth: number
  minimapHeight: number
  // Slide dimensions (normalized to 0-1)
  slideAspectRatio: number
  // Whether current user is presenter
  isPresenter: boolean
  // Cursors to display as dots
  cursors?: Array<{
    participant_id: string
    name: string
    color: string
    x: number // Normalized 0-1
    y: number // Normalized 0-1
  }>
  currentUserId?: string
}

export const MinimapOverlay = memo(function MinimapOverlay({
  presenterViewport,
  presenterInfo,
  currentViewport: _currentViewport,
  minimapWidth,
  minimapHeight,
  slideAspectRatio,
  isPresenter,
  cursors = [],
  currentUserId,
}: MinimapOverlayProps) {
  // _currentViewport reserved for future use (e.g., showing current viewport outline)
  void _currentViewport
  // Calculate viewport rectangle bounds in minimap coordinates
  const presenterRect = useMemo(() => {
    if (!presenterViewport || isPresenter) return null

    // Viewport width/height in normalized coordinates
    const vpWidth = 1 / presenterViewport.zoom
    const vpHeight = vpWidth / slideAspectRatio

    // Top-left corner in normalized coordinates
    const left = presenterViewport.centerX - vpWidth / 2
    const top = presenterViewport.centerY - vpHeight / 2

    // Convert to minimap pixel coordinates, properly clamping to minimap bounds
    const x = Math.max(0, left) * minimapWidth
    const y = Math.max(0, top) * minimapHeight
    const right = Math.min(1, left + vpWidth)
    const bottom = Math.min(1, top + vpHeight)
    const width = Math.max(0, (right - Math.max(0, left)) * minimapWidth)
    const height = Math.max(0, (bottom - Math.max(0, top)) * minimapHeight)

    return { x, y, width, height }
  }, [presenterViewport, minimapWidth, minimapHeight, slideAspectRatio, isPresenter])

  // Calculate cursor positions in minimap coordinates
  const cursorDots = useMemo(() => {
    return cursors
      .filter((c) => c.participant_id !== currentUserId)
      .map((cursor) => ({
        id: cursor.participant_id,
        name: cursor.name,
        color: cursor.color,
        x: cursor.x * minimapWidth,
        y: cursor.y * minimapHeight,
      }))
  }, [cursors, minimapWidth, minimapHeight, currentUserId])

  // Don't render if nothing to show
  if (!presenterRect && cursorDots.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        width: minimapWidth,
        height: minimapHeight,
      }}
    >
      {/* Presenter viewport rectangle */}
      {presenterRect && (
        <div
          className="absolute border-2 rounded-sm"
          style={{
            transform: `translate(${presenterRect.x}px, ${presenterRect.y}px)`,
            width: presenterRect.width,
            height: presenterRect.height,
            borderColor: presenterInfo?.color || '#3B82F6',
            backgroundColor: `${presenterInfo?.color || '#3B82F6'}20`,
            transition: 'transform 150ms ease-out, width 150ms ease-out, height 150ms ease-out',
            willChange: 'transform',
          }}
          title={`${presenterInfo?.name || 'Presenter'}'s view`}
        >
          {/* Small label */}
          <div
            className="absolute -top-4 left-0 text-[8px] font-medium whitespace-nowrap px-1 rounded"
            style={{
              backgroundColor: presenterInfo?.color || '#3B82F6',
              color: 'white',
            }}
          >
            Presenter
          </div>
        </div>
      )}

      {/* Cursor dots - uses transform for position (GPU-accelerated) */}
      {cursorDots.map((cursor) => (
        <div
          key={cursor.id}
          className="absolute w-2 h-2 rounded-full"
          style={{
            // Combine position transform with centering offset (-4px = half of 8px width/height)
            transform: `translate(${cursor.x - 4}px, ${cursor.y - 4}px)`,
            backgroundColor: cursor.color,
            boxShadow: `0 0 4px ${cursor.color}`,
            transition: 'transform 100ms linear',
            willChange: 'transform',
          }}
          title={cursor.name}
        />
      ))}
    </div>
  )
})
