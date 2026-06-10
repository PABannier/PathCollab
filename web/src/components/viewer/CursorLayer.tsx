import { memo, useMemo } from 'react'

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
  /** Re-render trigger: cursors are re-projected whenever the viewport changes. */
  viewport: { centerX: number; centerY: number; zoom: number }
  /** Slide-pixel → canvas-relative CSS px, using fovea's exact camera transform. */
  slideToScreen: (slideX: number, slideY: number) => { x: number; y: number } | null
  currentUserId?: string
}

export const CursorLayer = memo(function CursorLayer({
  cursors,
  viewerBounds,
  viewport,
  slideToScreen,
  currentUserId,
}: CursorLayerProps) {
  // Project each cursor's slide-pixel position to canvas-relative screen pixels
  // using fovea's own transform, so cursors land exactly where fovea renders that
  // slide point — identical for presenter and followers regardless of window size.
  const screenCursors = useMemo(() => {
    if (!viewerBounds || viewerBounds.width <= 0 || viewerBounds.height <= 0) return []

    const marginX = viewerBounds.width * 0.1
    const marginY = viewerBounds.height * 0.1

    return cursors
      .filter((cursor) => cursor.participant_id !== currentUserId)
      .map((cursor) => {
        const screen = slideToScreen(cursor.x, cursor.y)
        if (!screen) return null

        // Skip cursors well outside the visible canvas
        if (
          screen.x < -marginX ||
          screen.x > viewerBounds.width + marginX ||
          screen.y < -marginY ||
          screen.y > viewerBounds.height + marginY
        ) {
          return null
        }

        return { ...cursor, screenX: screen.x, screenY: screen.y }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    // `viewport` isn't read directly, but it's kept as a dependency on purpose:
    // slideToScreen reads fovea's live camera, so we re-project on viewport change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursors, viewerBounds, viewport, slideToScreen, currentUserId])

  if (!viewerBounds) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ width: viewerBounds.width, height: viewerBounds.height, zIndex: 20 }}
    >
      {screenCursors.map((cursor) => (
        <g
          key={cursor.participant_id}
          transform={`translate(${cursor.screenX}, ${cursor.screenY})`}
          style={{
            transition: 'transform 16ms linear', // Match 60fps for smooth cursor tracking
          }}
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
})
