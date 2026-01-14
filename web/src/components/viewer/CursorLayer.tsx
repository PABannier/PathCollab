import { useMemo } from 'react'

interface Cursor {
  participant_id: string
  name: string
  color: string
  is_presenter: boolean
  x: number
  y: number
}

interface CursorLayerProps {
  cursors: Cursor[]
  viewerBounds: DOMRect | null
  viewport: { centerX: number; centerY: number; zoom: number }
  slideWidth: number
  slideHeight: number
  currentUserId?: string
}

export function CursorLayer({
  cursors,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
  currentUserId,
}: CursorLayerProps) {
  // Convert slide coordinates to screen coordinates
  const screenCursors = useMemo(() => {
    if (!viewerBounds || viewport.zoom <= 0) return []
    if (slideWidth <= 0 || slideHeight <= 0) return []
    if (viewerBounds.width <= 0 || viewerBounds.height <= 0) return []

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    return cursors
      .filter((cursor) => cursor.participant_id !== currentUserId)
      .map((cursor) => {
        // Convert slide coordinates to normalized coordinates
        const normalizedX = cursor.x / slideWidth
        const normalizedY = cursor.y / slideHeight

        // Calculate position relative to viewport
        const relX = (normalizedX - (viewport.centerX - viewportWidth / 2)) / viewportWidth
        const relY = (normalizedY - (viewport.centerY - viewportHeight / 2)) / viewportHeight

        // Skip if outside viewport
        if (relX < -0.1 || relX > 1.1 || relY < -0.1 || relY > 1.1) {
          return null
        }

        // Convert to screen coordinates
        const screenX = viewerBounds.left + relX * viewerBounds.width
        const screenY = viewerBounds.top + relY * viewerBounds.height

        return {
          ...cursor,
          screenX,
          screenY,
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
  }, [cursors, viewerBounds, viewport, slideWidth, slideHeight, currentUserId])

  if (!viewerBounds) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ width: viewerBounds.width, height: viewerBounds.height }}
    >
      {screenCursors.map((cursor) => (
        <g
          key={cursor.participant_id}
          transform={`translate(${cursor.screenX - viewerBounds.left}, ${cursor.screenY - viewerBounds.top})`}
        >
          {/* Cursor arrow */}
          <path
            d="M0,0 L0,16 L4,12 L7,20 L10,19 L7,11 L12,11 Z"
            fill={cursor.color}
            stroke="#fff"
            strokeWidth={1}
            style={{
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
            }}
          />
          {/* Participant name label */}
          <g transform="translate(14, 18)">
            <rect
              x={-2}
              y={-10}
              width={(cursor.is_presenter ? cursor.name.length + 2 : cursor.name.length) * 7 + 8}
              height={14}
              rx={3}
              fill={cursor.color}
              opacity={0.9}
            />
            <text
              x={2}
              y={0}
              fontSize={10}
              fill="#fff"
              fontWeight={cursor.is_presenter ? 'bold' : 'normal'}
            >
              {cursor.is_presenter ? `★ ${cursor.name}` : cursor.name}
            </text>
          </g>
        </g>
      ))}
    </svg>
  )
}
