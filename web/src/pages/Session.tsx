import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { SlideViewerHandle } from '../components/viewer'
import { Sidebar, StatusBar } from '../components/layout'
import {
  ErrorBanner,
  FollowModeIndicator,
  KeyboardShortcutsHelp,
  NetworkErrorBanner,
  OverlayControls,
} from '../components/ui'
import {
  SessionFooter,
  SlideSelector,
  ShareLinkSection,
  ActiveUsersList,
  SessionConnectionStatus,
} from '../components/session'
import { ViewerArea } from '../components/viewer/ViewerArea'
import { useSession } from '../hooks/useSession'
import { usePresence } from '../hooks/usePresence'
import { useDefaultSlide } from '../hooks/useDefaultSlide'
import { useAvailableSlides } from '../hooks/useAvailableSlides'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useShareUrl } from '../hooks/useShareUrl'
import { useViewerViewport } from '../hooks/useViewerViewport'
import { useHashParams } from '../hooks/useHashParams'
import { useSlideInfo } from '../hooks/useSlideInfo'
import { useCellOverlay } from '../hooks/useCellOverlay'
import { useTissueOverlay } from '../hooks/useTissueOverlay'
import { useAutoCreateSession } from '../hooks/useAutoCreateSession'
import { useCursorTracking } from './Session/useCursorTracking'
import { useSessionKeyboardShortcuts } from './Session/useSessionKeyboardShortcuts'
import { AboutSection } from './Session/AboutSection'

export function Session() {
  const { id: sessionId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SlideViewerHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [cellOverlaysEnabled, setCellOverlaysEnabled] = useState(false)
  const [cellOverlayOpacity, setCellOverlayOpacity] = useState(0.9)
  const [visibleCellTypes, setVisibleCellTypes] = useState<Set<string>>(new Set())
  const [tissueOverlaysEnabled, setTissueOverlaysEnabled] = useState(false)
  const [tissueOverlayOpacity, setTissueOverlayOpacity] = useState(0.7)
  const [visibleTissueClasses, setVisibleTissueClasses] = useState<Set<number>>(new Set())

  // Parse secrets from URL hash fragment (never sent to server)
  const { joinSecret, presenterKey } = useHashParams()
  const slideParam = searchParams.get('slide')?.trim() || undefined

  // Fetch default slide for standalone viewer mode
  const { slide: defaultSlide, isLoading: isLoadingDefaultSlide } = useDefaultSlide()

  // Fetch all available slides for the slide selector
  const { slides: availableSlides } = useAvailableSlides()

  // Handle session creation - update URL to include session ID and secrets
  const handleSessionCreated = useCallback(
    (newSessionId: string, newJoinSecret: string, newPresenterKey: string) => {
      const presenterUrl = `/s/${newSessionId}#join=${newJoinSecret}&presenter=${newPresenterKey}`
      navigate(presenterUrl, { replace: true })
    },
    [navigate]
  )

  // Session hook
  const {
    session,
    currentUser,
    isPresenter,
    isCreatingSession,
    connectionStatus,
    latency,
    cursors,
    presenterViewport,
    secrets,
    isFollowing,
    hasDiverged,
    presenterCellOverlay,
    presenterTissueOverlay,
    createSession,
    updateCursor,
    updateViewport,
    changeSlide,
    snapToPresenter,
    setIsFollowing,
    checkDivergence,
    updateCellOverlay,
    updateTissueOverlay,
  } = useSession({
    sessionId,
    joinSecret,
    presenterKey,
    onError: setError,
    onSessionCreated: handleSessionCreated,
  })

  // Auto-create session when connected
  const { isWaitingForSession } = useAutoCreateSession({
    sessionId,
    joinSecret,
    slideParam,
    defaultSlideId: defaultSlide?.slide_id,
    session,
    connectionStatus,
    createSession,
  })

  // Derive current slide info
  const slide = useSlideInfo({
    sessionSlide: session?.slide,
    defaultSlide,
    isWaitingForSession,
  })

  // Share URL management
  const { shareUrl, copyState, handleShare } = useShareUrl({
    session,
    secrets,
    slide,
    createSession,
  })

  // Viewport state and handlers
  const {
    viewerBounds,
    currentViewport,
    handleViewportChange,
    handleSnapToPresenter,
    handleReturnToPresenter,
    handleZoomReset,
  } = useViewerViewport({
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
  })

  // Cell overlay data
  const {
    cells: allCells,
    isLoading: isLoadingCells,
    hasOverlay,
    isOverlayLoading,
    overlayMetadata,
  } = useCellOverlay({
    slideId: slide?.id,
    viewport: currentViewport,
    viewerBounds,
    slideWidth: slide?.width ?? 0,
    slideHeight: slide?.height ?? 0,
    enabled: cellOverlaysEnabled && !!slide,
  })

  // Tissue overlay data
  const {
    metadata: tissueMetadata,
    tiles: tissueTiles,
    tileIndex: tissueTileIndex,
    currentLevel: tissueCurrentLevel,
    isLoading: isLoadingTissue,
    hasOverlay: hasTissueOverlay,
    isOverlayLoading: isTissueOverlayLoading,
  } = useTissueOverlay({
    slideId: slide?.id,
    viewport: currentViewport,
    viewerBounds,
    slideWidth: slide?.width ?? 0,
    slideHeight: slide?.height ?? 0,
    enabled: tissueOverlaysEnabled && !!slide,
  })

  // Initialize visible cell types when metadata loads
  // This is intentional state sync from external data (server response) to local state
  useEffect(() => {
    if (overlayMetadata?.cell_types) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing server state to local state
      setVisibleCellTypes(new Set(overlayMetadata.cell_types))
    }
  }, [overlayMetadata?.cell_types])

  // Initialize visible tissue classes when metadata loads
  useEffect(() => {
    if (tissueMetadata?.classes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing server state to local state
      setVisibleTissueClasses(new Set(tissueMetadata.classes.map((c) => c.id)))
    }
  }, [tissueMetadata?.classes])

  // Filter cells by visible types
  const cells = useMemo(() => {
    if (visibleCellTypes.size === 0) return []
    return allCells.filter((cell) => visibleCellTypes.has(cell.cell_type))
  }, [allCells, visibleCellTypes])

  // Wrapper functions that broadcast when presenter changes overlay settings
  const handleCellOverlaysChange = useCallback(
    (enabled: boolean) => {
      setCellOverlaysEnabled(enabled)
      if (isPresenter && session) {
        updateCellOverlay(enabled, cellOverlayOpacity, Array.from(visibleCellTypes))
      }
    },
    [isPresenter, session, cellOverlayOpacity, visibleCellTypes, updateCellOverlay]
  )

  const handleCellOverlayOpacityChange = useCallback(
    (opacity: number) => {
      setCellOverlayOpacity(opacity)
      if (isPresenter && session) {
        updateCellOverlay(cellOverlaysEnabled, opacity, Array.from(visibleCellTypes))
      }
    },
    [isPresenter, session, cellOverlaysEnabled, visibleCellTypes, updateCellOverlay]
  )

  const handleVisibleCellTypesChange = useCallback(
    (types: Set<string>) => {
      setVisibleCellTypes(types)
      if (isPresenter && session) {
        updateCellOverlay(cellOverlaysEnabled, cellOverlayOpacity, Array.from(types))
      }
    },
    [isPresenter, session, cellOverlaysEnabled, cellOverlayOpacity, updateCellOverlay]
  )

  // Tissue overlay handlers - broadcasts to followers when presenter changes settings
  const handleTissueOverlaysChange = useCallback(
    (enabled: boolean) => {
      setTissueOverlaysEnabled(enabled)
      if (isPresenter && session) {
        updateTissueOverlay(enabled, tissueOverlayOpacity, Array.from(visibleTissueClasses))
      }
    },
    [isPresenter, session, tissueOverlayOpacity, visibleTissueClasses, updateTissueOverlay]
  )

  const handleTissueOverlayOpacityChange = useCallback(
    (opacity: number) => {
      setTissueOverlayOpacity(opacity)
      if (isPresenter && session) {
        updateTissueOverlay(tissueOverlaysEnabled, opacity, Array.from(visibleTissueClasses))
      }
    },
    [isPresenter, session, tissueOverlaysEnabled, visibleTissueClasses, updateTissueOverlay]
  )

  const handleVisibleTissueClassesChange = useCallback(
    (types: Set<number>) => {
      setVisibleTissueClasses(types)
      if (isPresenter && session) {
        updateTissueOverlay(tissueOverlaysEnabled, tissueOverlayOpacity, Array.from(types))
      }
    },
    [isPresenter, session, tissueOverlaysEnabled, tissueOverlayOpacity, updateTissueOverlay]
  )

  // Sync follower state when presenter cell overlay changes
  // This is intentional state sync: followers receive presenter's overlay state via WebSocket
  useEffect(() => {
    if (!isPresenter && presenterCellOverlay) {
      /* eslint-disable react-hooks/set-state-in-effect -- syncing presenter state to follower */
      setCellOverlaysEnabled(presenterCellOverlay.enabled)
      setCellOverlayOpacity(presenterCellOverlay.opacity)
      setVisibleCellTypes(new Set(presenterCellOverlay.visibleCellTypes))
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isPresenter, presenterCellOverlay])

  // Sync follower state when presenter tissue overlay changes
  // This is intentional state sync: followers receive presenter's overlay state via WebSocket
  useEffect(() => {
    if (!isPresenter && presenterTissueOverlay) {
      /* eslint-disable react-hooks/set-state-in-effect -- syncing presenter state to follower */
      setTissueOverlaysEnabled(presenterTissueOverlay.enabled)
      setTissueOverlayOpacity(presenterTissueOverlay.opacity)
      setVisibleTissueClasses(new Set(presenterTissueOverlay.visibleTissueTypes))
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isPresenter, presenterTissueOverlay])

  // Presence tracking
  const { startTracking, stopTracking, updateCursorPosition, convertToSlideCoords } = usePresence({
    enabled: !!session && !!slide,
    cursorUpdateHz: 30,
    onCursorUpdate: updateCursor,
    slideWidth: slide?.width ?? 0,
    slideHeight: slide?.height ?? 0,
  })

  // Cursor tracking (footer position + session updates)
  const { footerCursorPos, handleMouseMove, handleMouseLeave } = useCursorTracking({
    session,
    viewerBounds,
    currentViewport,
    convertToSlideCoords,
    updateCursorPosition,
    startTracking,
    stopTracking,
  })

  // Handle slide change
  const handleSlideChange = useCallback(
    (newSlideId: string) => {
      if (!newSlideId || newSlideId === slide?.id) return
      changeSlide(newSlideId)
    },
    [slide?.id, changeSlide]
  )

  // Keyboard shortcuts
  const { shortcuts } = useSessionKeyboardShortcuts({
    handleZoomReset,
    handleSnapToPresenter,
    handleShare,
    setShowHelp,
  })

  useKeyboardShortcuts({
    shortcuts,
    enabled: true,
  })

  const isSoloMode = connectionStatus === 'solo'

  return (
    <div className="flex h-screen flex-col">
      {/* Status Bar */}
      <StatusBar
        center={
          slide && (
            <span className="text-sm text-gray-200 truncate max-w-[600px]" title={slide.name}>
              {slide.name}
            </span>
          )
        }
      />

      {/* Network error banner */}
      <NetworkErrorBanner connectionStatus={connectionStatus} />

      {/* Error banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Two-pane layout: Sidebar + Viewer */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar>
          {/* Follow presenter indicator (followers only) */}
          {session && !isPresenter && (
            <FollowModeIndicator isFollowing={isFollowing} onFollowChange={setIsFollowing} />
          )}

          {/* Connection status */}
          {!isSoloMode && (
            <SessionConnectionStatus status={connectionStatus} isPresenter={isPresenter} />
          )}

          {/* Slide selector */}
          {slide && (
            <SlideSelector
              currentSlideId={slide.id}
              currentSlideName={slide.name}
              availableSlides={availableSlides}
              isPresenter={isPresenter}
              onSlideChange={handleSlideChange}
            />
          )}

          {/* Share Link section (presenter only) */}
          {slide && !isSoloMode && isPresenter && (
            <ShareLinkSection
              shareUrl={shareUrl}
              copyState={copyState}
              isCreatingSession={isCreatingSession}
              onShare={handleShare}
            />
          )}

          {/* Active Users section */}
          {session && (
            <ActiveUsersList
              presenter={session.presenter}
              followers={session.followers}
              currentUserId={currentUser?.id}
            />
          )}

          {/* Overlay controls */}
          {slide && (
            <OverlayControls
              cellOverlaysEnabled={cellOverlaysEnabled}
              onCellOverlaysChange={handleCellOverlaysChange}
              hasCellOverlay={hasOverlay && !isOverlayLoading}
              isOverlayLoading={isOverlayLoading}
              cellCount={overlayMetadata?.cell_count}
              opacity={cellOverlayOpacity}
              onOpacityChange={handleCellOverlayOpacityChange}
              cellTypes={overlayMetadata?.cell_types ?? []}
              visibleCellTypes={visibleCellTypes}
              onVisibleCellTypesChange={handleVisibleCellTypesChange}
              tissueOverlaysEnabled={tissueOverlaysEnabled}
              onTissueOverlaysChange={handleTissueOverlaysChange}
              hasTissueOverlay={hasTissueOverlay && !isTissueOverlayLoading}
              isTissueOverlayLoading={isTissueOverlayLoading}
              tissueOpacity={tissueOverlayOpacity}
              onTissueOpacityChange={handleTissueOverlayOpacityChange}
              tissueClasses={tissueMetadata?.classes ?? []}
              visibleTissueClasses={visibleTissueClasses}
              onVisibleTissueClassesChange={handleVisibleTissueClassesChange}
            />
          )}

          {/* About section */}
          <AboutSection />
        </Sidebar>

        {/* Main viewer area */}
        <ViewerArea
          containerRef={viewerContainerRef}
          viewerRef={viewerRef}
          slide={slide}
          connectionStatus={connectionStatus}
          isLoadingDefaultSlide={isLoadingDefaultSlide}
          isCreatingSession={isCreatingSession}
          viewerBounds={viewerBounds}
          currentViewport={currentViewport}
          hasSession={!!session}
          isPresenter={isPresenter}
          hasDiverged={hasDiverged}
          cursors={cursors}
          presenterViewport={presenterViewport}
          presenterInfo={session?.presenter ?? null}
          currentUserId={currentUser?.id}
          onViewportChange={handleViewportChange}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onReturnToPresenter={handleReturnToPresenter}
          onShowHelp={() => setShowHelp(true)}
          cellOverlaysEnabled={cellOverlaysEnabled}
          cells={cells}
          cellOverlayOpacity={cellOverlayOpacity}
          tissueOverlaysEnabled={tissueOverlaysEnabled}
          tissueMetadata={tissueMetadata}
          tissueTiles={tissueTiles}
          tissueTileIndex={tissueTileIndex}
          tissueCurrentLevel={tissueCurrentLevel}
          tissueOverlayOpacity={tissueOverlayOpacity}
          visibleTissueClasses={visibleTissueClasses}
        />
      </div>

      <SessionFooter
        session={session}
        connectionStatus={connectionStatus}
        latency={latency}
        currentViewport={currentViewport}
        footerCursorPos={footerCursorPos}
        isLoadingCells={
          (cellOverlaysEnabled && isLoadingCells) || (tissueOverlaysEnabled && isLoadingTissue)
        }
      />

      {/* Keyboard shortcuts help modal */}
      {showHelp && (
        <KeyboardShortcutsHelp
          shortcuts={[
            { key: '0', ctrl: true, description: 'Reset zoom to fit' },
            { key: 'f', ctrl: true, description: 'Follow presenter' },
            { key: 'l', ctrl: true, description: 'Copy share link' },
            { key: 'Escape', description: 'Close panels / exit follow mode' },
            { key: '?', description: 'Show this help' },
          ]}
          onClose={() => setShowHelp(false)}
        />
      )}
    </div>
  )
}
