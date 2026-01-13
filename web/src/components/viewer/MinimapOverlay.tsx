import { useMemo } from 'react'

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
    x: number  // Normalized 0-1
    y: number  // Normalized 0-1
  }>
  currentUserId?: string
}

export function MinimapOverlay({
  presenterViewport,
  presenterInfo,
  currentViewport,
  minimapWidth,
  minimapHeight,
  slideAspectRatio,
  isPresenter,
  cursors = [],
  currentUserId,
}: MinimapOverlayProps) {
  // Calculate viewport rectangle bounds in minimap coordinates
  const presenterRect = useMemo(() => {
    if (!presenterViewport || isPresenter) return null

    // Viewport width/height in normalized coordinates
    const vpWidth = 1 / presenterViewport.zoom
    const vpHeight = vpWidth / slideAspectRatio

    // Top-left corner in normalized coordinates
    const left = presenterViewport.centerX - vpWidth / 2
    const top = presenterViewport.centerY - vpHeight / 2

    // Convert to minimap pixel coordinates
    return {
      x: Math.max(0, left * minimapWidth),
      y: Math.max(0, top * minimapHeight),
      width: Math.min(minimapWidth - left * minimapWidth, vpWidth * minimapWidth),
      height: Math.min(minimapHeight - top * minimapHeight, vpHeight * minimapHeight),
    }
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
          className="absolute border-2 rounded-sm transition-all duration-150"
          style={{
            left: presenterRect.x,
            top: presenterRect.y,
            width: presenterRect.width,
            height: presenterRect.height,
            borderColor: presenterInfo?.color || '#3B82F6',
            backgroundColor: `${presenterInfo?.color || '#3B82F6'}20`,
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

      {/* Cursor dots */}
      {cursorDots.map((cursor) => (
        <div
          key={cursor.id}
          className="absolute w-2 h-2 rounded-full -translate-x-1 -translate-y-1 transition-all duration-100"
          style={{
            left: cursor.x,
            top: cursor.y,
            backgroundColor: cursor.color,
            boxShadow: `0 0 4px ${cursor.color}`,
          }}
          title={cursor.name}
        />
      ))}
    </div>
  )
}
