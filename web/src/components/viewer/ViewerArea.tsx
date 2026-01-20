import { type RefObject, useMemo } from 'react'
import { SlideViewer, type SlideInfo, type SlideViewerHandle, ViewportLoader } from './index'
import { CellOverlay } from './CellOverlay'
import { CursorLayer } from './CursorLayer'
import type { CellMask } from '../../types/overlay'
import { MinimapOverlay } from './MinimapOverlay'
import { PresetEmptyState } from '../ui/EmptyState'
import { ReturnToPresenterButton } from '../ui/ReturnToPresenterButton'
import { KeyboardShortcutsHint } from '../ui/KeyboardShortcutsHint'
import type { ConnectionStatus } from '../../hooks/useWebSocket'
import type { Participant, Viewport } from '../../hooks/useSession'

export interface CursorData {
  participant_id: string
  name: string
  color: string
  x: number
  y: number
}

export interface ViewerAreaProps {
  /** Reference to the viewer container element */
  containerRef: RefObject<HTMLDivElement | null>
  /** Reference to the SlideViewer handle */
  viewerRef: RefObject<SlideViewerHandle | null>
  /** Current slide info (null shows loading/empty state) */
  slide: SlideInfo | null
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus
  /** Whether default slide is loading */
  isLoadingDefaultSlide: boolean
  /** Whether session is being created */
  isCreatingSession: boolean
  /** Current viewport bounds (for cursor/minimap calculations) */
  viewerBounds: DOMRect | null
  /** Current viewport state */
  currentViewport: Viewport
  /** Active session exists */
  hasSession: boolean
  /** Whether current user is presenter */
  isPresenter: boolean
  /** Whether follower has diverged from presenter */
  hasDiverged: boolean
  /** Cursor data from all participants */
  cursors: CursorData[]
  /** Presenter's current viewport */
  presenterViewport: Viewport | null
  /** Presenter info for minimap */
  presenterInfo: Participant | null
  /** Current user's ID */
  currentUserId: string | undefined
  /** Callback when viewport changes */
  onViewportChange: (viewport: Viewport) => void
  /** Callback when mouse moves */
  onMouseMove: (e: React.MouseEvent) => void
  /** Callback when mouse leaves viewer */
  onMouseLeave: () => void
  /** Callback to return to presenter view */
  onReturnToPresenter: () => void
  /** Callback to show keyboard shortcuts help */
  onShowHelp: () => void
  /** Whether cell overlays are enabled */
  cellOverlaysEnabled?: boolean
  /** Cell mask data for overlay */
  cells?: CellMask[]
}

/**
 * Main viewer area component containing the slide viewer and all overlays.
 * Handles loading states, cursor layer, minimap, and return-to-presenter button.
 */
export function ViewerArea({
  containerRef,
  viewerRef,
  slide,
  connectionStatus,
  isLoadingDefaultSlide,
  isCreatingSession,
  viewerBounds,
  currentViewport,
  hasSession,
  isPresenter,
  hasDiverged,
  cursors,
  presenterViewport,
  presenterInfo,
  currentUserId,
  onViewportChange,
  onMouseMove,
  onMouseLeave,
  onReturnToPresenter,
  onShowHelp,
  cellOverlaysEnabled,
  cells,
}: ViewerAreaProps) {
  // Memoize normalized cursors for minimap to avoid creating new array/objects on every render
  const normalizedCursors = useMemo(() => {
    if (!slide) return []
    return cursors.map((c) => ({
      participant_id: c.participant_id,
      name: c.name,
      color: c.color,
      x: c.x / slide.width,
      y: c.y / slide.height,
    }))
  }, [cursors, slide])

  return (
    <main
      className="relative flex-1 overflow-hidden"
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* Loading/empty states */}
      {!slide && (
        <ViewerLoadingState
          connectionStatus={connectionStatus}
          isLoadingDefaultSlide={isLoadingDefaultSlide}
          isCreatingSession={isCreatingSession}
        />
      )}

      {/* Slide viewer */}
      {slide && <SlideViewer ref={viewerRef} slide={slide} onViewportChange={onViewportChange} />}

      {/* Cursor overlay */}
      {hasSession && viewerBounds && slide && (
        <CursorLayer
          cursors={cursors}
          viewerBounds={viewerBounds}
          viewport={currentViewport}
          slideWidth={slide.width}
          slideHeight={slide.height}
          currentUserId={currentUserId}
        />
      )}

      {/* Cell overlay */}
      {cellOverlaysEnabled && viewerBounds && slide && cells && cells.length > 0 && (
        <CellOverlay
          cells={cells}
          viewerBounds={viewerBounds}
          viewport={currentViewport}
          slideWidth={slide.width}
          slideHeight={slide.height}
        />
      )}

      {/* Minimap overlay showing presenter viewport for followers */}
      {hasSession && slide && !isPresenter && presenterViewport && presenterInfo && (
        <div
          className="absolute"
          style={{
            bottom: 16,
            right: 16,
            width: 150,
            height: 150,
          }}
        >
          <MinimapOverlay
            presenterViewport={presenterViewport}
            presenterInfo={presenterInfo}
            currentViewport={currentViewport}
            minimapWidth={150}
            minimapHeight={150}
            slideAspectRatio={slide.width / slide.height}
            isPresenter={isPresenter}
            cursors={normalizedCursors}
            currentUserId={currentUserId}
          />
        </div>
      )}

      {/* Return to presenter floating button (followers only, when diverged) */}
      {hasSession && !isPresenter && hasDiverged && presenterInfo && (
        <ReturnToPresenterButton onClick={onReturnToPresenter} presenterName={presenterInfo.name} />
      )}

      {/* Keyboard shortcuts hint */}
      <KeyboardShortcutsHint onClick={onShowHelp} />
    </main>
  )
}

interface ViewerLoadingStateProps {
  connectionStatus: ConnectionStatus
  isLoadingDefaultSlide: boolean
  isCreatingSession: boolean
}

function ViewerLoadingState({
  connectionStatus,
  isLoadingDefaultSlide,
  isCreatingSession,
}: ViewerLoadingStateProps) {
  if (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') {
    return (
      <ViewportLoader message="Connecting..." subMessage="Establishing connection to session" />
    )
  }

  if (isLoadingDefaultSlide || isCreatingSession) {
    return <ViewportLoader message="Loading slide..." subMessage="Preparing viewport" />
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-900">
      <PresetEmptyState preset="no-slides" />
    </div>
  )
}
