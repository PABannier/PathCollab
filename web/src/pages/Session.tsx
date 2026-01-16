import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  SlideViewer,
  type SlideInfo,
  type SlideViewerHandle,
  ViewportLoader,
} from '../components/viewer'
import { CursorLayer } from '../components/viewer/CursorLayer'
import { OverlayCanvas } from '../components/viewer/OverlayCanvas'
import { TissueHeatmapLayer } from '../components/viewer/TissueHeatmapLayer'
import { MinimapOverlay } from '../components/viewer/MinimapOverlay'
import { CellTooltip } from '../components/viewer/CellTooltip'
import { OverlayUploader } from '../components/upload/OverlayUploader'
import { Sidebar, SidebarSection } from '../components/layout'
import { SessionFooter } from '../components/session'
import { StatusBar, ConnectionBadge } from '../components/layout'
import {
  Button,
  FollowModeIndicator,
  KeyboardShortcutsHelp,
  LayerControls,
  NetworkErrorBanner,
  PresetEmptyState,
  ReturnToPresenterButton,
} from '../components/ui'
import { useSession, type OverlayManifest } from '../hooks/useSession'
import { usePresence } from '../hooks/usePresence'
import { useDefaultSlide } from '../hooks/useDefaultSlide'
import { useAvailableSlides } from '../hooks/useAvailableSlides'
import { useKeyboardShortcuts, type KeyboardShortcut } from '../hooks/useKeyboardShortcuts'
import { useShareUrl } from '../hooks/useShareUrl'
import { useLayerVisibility } from '../hooks/useLayerVisibility'
import { useOverlayCells } from '../hooks/useOverlayCells'
import { useViewerViewport } from '../hooks/useViewerViewport'
import { DEFAULT_CELL_CLASSES, DEFAULT_TISSUE_CLASSES } from '../constants'

// Demo slide configuration - will be replaced with actual data from backend
const DEMO_SLIDE_BASE: Omit<SlideInfo, 'tileUrlTemplate'> = {
  id: 'demo',
  name: 'Demo Slide',
  width: 100000,
  height: 100000,
  tileSize: 256,
  numLevels: 10,
}

export function Session() {
  const { id: sessionId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SlideViewerHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const autoCreateRequestedRef = useRef(false)

  // Overlay state (metadata only - cells are fetched by useOverlayCells, visibility by useLayerVisibility)
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [overlayManifest, setOverlayManifest] = useState<OverlayManifest | null>(null)

  // Footer cursor position (for displaying coordinates)
  const [footerCursorPos, setFooterCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Get secrets from URL hash fragment (not sent to server)
  const hashParams = useMemo(() => {
    const hash = window.location.hash.slice(1)
    return new URLSearchParams(hash)
  }, [])
  // Only read secrets from hash fragment (never sent to server) - do NOT use searchParams
  const joinSecret = hashParams.get('join') || undefined
  const presenterKey = hashParams.get('presenter') || undefined
  const slideParam = searchParams.get('slide')?.trim() || undefined

  // Fetch default slide for standalone viewer mode (when no sessionId)
  const { slide: defaultSlide, isLoading: isLoadingDefaultSlide } = useDefaultSlide()

  // Fetch all available slides for the slide selector
  const { slides: availableSlides } = useAvailableSlides()

  // Handle overlay loaded
  const handleOverlayLoaded = useCallback((id: string, manifest: OverlayManifest) => {
    setOverlayId(id)
    setOverlayManifest(manifest)
    setNotification(`Overlay loaded: ${id}`)
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Handle session creation - update URL to include session ID and secrets
  const handleSessionCreated = useCallback(
    (newSessionId: string, newJoinSecret: string, newPresenterKey: string) => {
      // Build presenter URL with secrets in hash fragment (never sent to server)
      const presenterUrl = `/s/${newSessionId}#join=${newJoinSecret}&presenter=${newPresenterKey}`
      // Replace current URL without adding to history
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
    createSession,
    updateCursor,
    updateViewport,
    updateLayerVisibility,
    changeSlide,
    snapToPresenter,
    setIsFollowing,
    checkDivergence,
  } = useSession({
    sessionId,
    joinSecret,
    presenterKey,
    onError: setError,
    onOverlayLoaded: handleOverlayLoaded,
    onSessionCreated: handleSessionCreated,
  })

  const autoCreateSlideId = useMemo(() => {
    if (joinSecret) return null
    if (sessionId === 'new') {
      return slideParam || null
    }
    if (sessionId === 'demo') {
      return 'demo'
    }
    return null
  }, [joinSecret, sessionId, slideParam])

  // Auto-create session when connected and slide is available
  // This makes collaboration seamless - users arrive and can immediately share
  useEffect(() => {
    // Don't auto-create if we're joining an existing session
    if (sessionId && sessionId !== 'new' && sessionId !== 'demo') return
    // Don't create if already have a session or not connected
    if (session || connectionStatus !== 'connected') return
    // Don't create twice
    if (autoCreateRequestedRef.current) return
    // Need a slide to create session
    const slideId = autoCreateSlideId || slideParam || defaultSlide?.slide_id
    if (!slideId) return

    autoCreateRequestedRef.current = true
    createSession(slideId)
  }, [
    autoCreateSlideId,
    connectionStatus,
    createSession,
    session,
    sessionId,
    slideParam,
    defaultSlide?.slide_id,
  ])

  // Layer visibility state and handlers
  const {
    tissueEnabled,
    tissueOpacity,
    visibleTissueClasses,
    cellsEnabled,
    cellsOpacity,
    visibleCellClasses,
    cellHoverEnabled,
    layerControlsDisabled,
    handleTissueEnabledChange,
    handleTissueOpacityChange,
    handleVisibleTissueClassesChange,
    handleCellsEnabledChange,
    handleCellsOpacityChange,
    handleVisibleCellClassesChange,
    handleCellHoverEnabledChange,
  } = useLayerVisibility({
    session,
    isPresenter,
    updateLayerVisibility,
  })

  // Determine if we're waiting for a session to be created
  // If autoCreateSlideId is set and session is not created yet, we should wait
  // In solo mode, we never wait for session (there is no session)
  const isWaitingForSession = connectionStatus !== 'solo' && !!autoCreateSlideId && !session

  // Get slide info from session or use default slide from API
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const slide = useMemo((): SlideInfo | null => {
    // 1. Use session slide if available
    if (session?.slide) {
      return {
        id: session.slide.id,
        name: session.slide.name,
        width: session.slide.width,
        height: session.slide.height,
        tileSize: session.slide.tile_size,
        numLevels: session.slide.num_levels,
        tileUrlTemplate: session.slide.tile_url_template,
      }
    }
    // 2. Don't show anything if we're waiting for session creation
    if (isWaitingForSession) {
      return null
    }
    // 3. Use default slide from API (for standalone viewer mode)
    if (defaultSlide) {
      // Calculate numLevels from slide dimensions (DZI formula)
      const maxDim = Math.max(defaultSlide.width, defaultSlide.height)
      const numLevels = maxDim > 0 ? Math.ceil(Math.log2(maxDim)) + 1 : 1
      return {
        id: defaultSlide.slide_id,
        name: defaultSlide.name,
        width: defaultSlide.width,
        height: defaultSlide.height,
        tileSize: 256,
        numLevels,
        tileUrlTemplate: `/api/slide/${defaultSlide.slide_id}/tile/{level}/{x}/{y}`,
      }
    }
    // 4. Fallback to demo slide while loading or if no slides available
    if (isLoadingDefaultSlide) {
      return null // Show loading state
    }
    return {
      ...DEMO_SLIDE_BASE,
      tileUrlTemplate: `/api/slide/${DEMO_SLIDE_BASE.id}/tile/{level}/{x}/{y}`,
    }
  }, [session?.slide, isWaitingForSession, defaultSlide, isLoadingDefaultSlide])

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

  // Presence tracking
  const { startTracking, stopTracking, updateCursorPosition, convertToSlideCoords } = usePresence({
    enabled: !!session && !!slide,
    cursorUpdateHz: 30,
    onCursorUpdate: updateCursor,
    slideWidth: slide?.width ?? 0,
    slideHeight: slide?.height ?? 0,
  })

  // Start cursor tracking when session is active
  useEffect(() => {
    if (session) {
      startTracking()
    }
    return () => stopTracking()
  }, [session, startTracking, stopTracking])

  // Fetch overlay cells based on viewport
  const { overlayCells } = useOverlayCells({
    overlayId,
    overlayManifest,
    cellsEnabled,
    currentViewport,
    viewerBounds,
    slide,
  })

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

  // Handle slide change - sends change_slide message to server
  const handleSlideChange = useCallback(
    (newSlideId: string) => {
      if (!newSlideId || newSlideId === slide?.id) return
      changeSlide(newSlideId)
    },
    [slide?.id, changeSlide]
  )

  // Help dialog state - managed separately to avoid circular dependency with shortcuts
  const [showHelp, setShowHelp] = useState(false)

  // Keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        key: '0',
        ctrl: true,
        description: 'Reset zoom to fit',
        action: handleZoomReset,
      },
      {
        key: 'f',
        ctrl: true,
        description: 'Follow presenter',
        action: handleSnapToPresenter,
      },
      {
        key: 'l',
        ctrl: true,
        description: 'Copy share link',
        action: handleShare,
      },
      {
        key: 'Escape',
        description: 'Close panels',
        action: () => setShowHelp(false),
      },
    ],
    [handleZoomReset, handleSnapToPresenter, handleShare, setShowHelp]
  )

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

      {/* Network error banner (fixed position) */}
      <NetworkErrorBanner connectionStatus={connectionStatus} />

      {/* Error banner with helpful guidance */}
      {error && (
        <div
          className="bg-red-600 px-4 py-2 text-sm text-white flex items-center justify-between gap-4"
          role="alert"
        >
          <div className="flex items-center gap-2 flex-1">
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {error.toLowerCase().includes('upload') && (
              <a
                href="https://github.com/PABannier/PathCollab#troubleshooting"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/80 hover:text-white underline text-xs"
              >
                Help
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setError(null)}
              className="text-white hover:bg-red-700"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Notification banner */}
      {notification && (
        <div className="bg-green-600 px-4 py-2 text-sm text-white">{notification}</div>
      )}

      {/* Two-pane layout: Sidebar + Viewer */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar>
          {/* Follow presenter indicator (followers only) */}
          {session && !isPresenter && (
            <FollowModeIndicator isFollowing={isFollowing} onFollowChange={setIsFollowing} />
          )}

          {/* Connection status */}
          {!isSoloMode && (
            <div className="mb-4 flex items-center gap-2">
              <ConnectionBadge status={connectionStatus} />
              <span className="text-gray-400 italic text-sm">
                {connectionStatus === 'connected'
                  ? isPresenter
                    ? 'You are presenting'
                    : 'You are following'
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : connectionStatus === 'reconnecting'
                      ? 'Reconnecting...'
                      : 'Disconnected'}
              </span>
            </div>
          )}

          {/* Slide selector (presenter) or current slide display (followers) */}
          {slide && (
            <div className="mb-4">
              <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
                {isPresenter && availableSlides.length > 1 ? 'Choose Slide' : 'Current Slide'}
              </p>
              {isPresenter && availableSlides.length > 1 ? (
                <select
                  value={slide.id}
                  onChange={(e) => handleSlideChange(e.target.value)}
                  className="w-full text-gray-300 text-sm rounded px-2 py-1.5 border-0 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  style={{ backgroundColor: '#3C3C3C' }}
                >
                  {availableSlides.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-gray-400 text-sm truncate" title={slide.name}>
                  {slide.name}
                </p>
              )}
            </div>
          )}

          {/* Share Link section (presenter only) */}
          {slide && !isSoloMode && isPresenter && (
            <div className="mb-4">
              <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
                Share Link
              </p>
              {shareUrl ? (
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="w-full text-gray-300 text-sm rounded px-2 py-1.5 pr-14 border-0 focus:outline-none focus:ring-1 focus:ring-blue-500 truncate"
                    style={{ backgroundColor: '#3C3C3C' }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    title={shareUrl}
                  />
                  <button
                    onClick={handleShare}
                    disabled={copyState === 'success'}
                    className={`absolute right-1 top-1 bottom-1 px-2 text-xs font-medium rounded transition-colors ${
                      copyState === 'success'
                        ? 'bg-green-600 text-white'
                        : copyState === 'error'
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'text-white hover:opacity-80'
                    }`}
                    style={
                      copyState !== 'success' && copyState !== 'error'
                        ? { backgroundColor: '#575759' }
                        : undefined
                    }
                  >
                    {copyState === 'success' ? 'Copied!' : copyState === 'error' ? 'Retry' : 'Copy'}
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleShare}
                  className="w-full"
                  loading={isCreatingSession}
                >
                  {isCreatingSession ? 'Creating...' : 'Create Share Link'}
                </Button>
              )}
            </div>
          )}

          {/* Active Users section */}
          {session && (
            <div className="mb-4">
              <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
                Active Users
              </p>
              <div className="flex flex-col gap-1">
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                  style={{ backgroundColor: 'var(--color-gray-700)' }}
                >
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: session.presenter.color }}
                    aria-hidden="true"
                  />
                  <span className="text-gray-300">
                    {session.presenter.name}
                    {currentUser?.id === session.presenter.id && (
                      <span className="text-gray-400 ml-1">(you)</span>
                    )}
                  </span>
                  <span
                    className="ml-auto flex items-center gap-1"
                    style={{ color: 'var(--color-accent-purple)' }}
                  >
                    <span className="text-xs">★</span>
                    <span className="text-gray-500">host</span>
                  </span>
                </div>
                {session.followers.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                    style={{ backgroundColor: 'var(--color-gray-700)' }}
                  >
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: f.color }}
                      aria-hidden="true"
                    />
                    <span className="text-gray-300">
                      {f.name}
                      {currentUser?.id === f.id && (
                        <span className="text-gray-400 ml-1">(you)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overlay upload (presenter only) */}
          {session && isPresenter && !overlayId && (
            <SidebarSection title="Overlay">
              <OverlayUploader
                sessionId={session.id}
                presenterKey={secrets?.presenterKey ?? presenterKey}
                onUploadComplete={(id) => {
                  setOverlayId(id)
                  setNotification('Overlay uploaded successfully!')
                  setTimeout(() => setNotification(null), 3000)
                }}
                onError={setError}
              />
            </SidebarSection>
          )}

          {/* Layer controls (when overlay is loaded) */}
          {overlayId && (
            <SidebarSection title="Layers">
              <LayerControls
                tissueEnabled={tissueEnabled}
                onTissueEnabledChange={handleTissueEnabledChange}
                tissueOpacity={tissueOpacity}
                onTissueOpacityChange={handleTissueOpacityChange}
                tissueClasses={DEFAULT_TISSUE_CLASSES}
                visibleTissueClasses={visibleTissueClasses}
                onVisibleTissueClassesChange={handleVisibleTissueClassesChange}
                cellsEnabled={cellsEnabled}
                onCellsEnabledChange={handleCellsEnabledChange}
                cellsOpacity={cellsOpacity}
                onCellsOpacityChange={handleCellsOpacityChange}
                cellClasses={DEFAULT_CELL_CLASSES}
                visibleCellClasses={visibleCellClasses}
                onVisibleCellClassesChange={handleVisibleCellClassesChange}
                cellHoverEnabled={cellHoverEnabled}
                onCellHoverEnabledChange={handleCellHoverEnabledChange}
                disabled={layerControlsDisabled}
              />
            </SidebarSection>
          )}

          {/* About section */}
          <SidebarSection title="About">
            <p className="text-gray-300 leading-relaxed mb-3" style={{ fontSize: '0.875rem' }}>
              PathCollab is a real-time collaborative viewer for whole-slide images. Share your
              slide with colleagues and explore together with synchronized views and live cursors.
            </p>
            <a
              href="https://github.com/PABannier/PathCollab"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors"
              style={{ fontSize: '0.875rem' }}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>Repository</span>
            </a>
          </SidebarSection>
        </Sidebar>

        {/* Main viewer area */}
        <main
          className="relative flex-1 overflow-hidden"
          ref={viewerContainerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Show loading or empty state while waiting for slide */}
          {!slide && (
            <>
              {connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? (
                <ViewportLoader
                  message="Connecting..."
                  subMessage="Establishing connection to session"
                />
              ) : isLoadingDefaultSlide || isCreatingSession ? (
                <ViewportLoader message="Loading slide..." subMessage="Preparing viewport" />
              ) : (
                <div className="flex h-full items-center justify-center bg-gray-900">
                  <PresetEmptyState preset="no-slides" />
                </div>
              )}
            </>
          )}
          {slide && (
            <SlideViewer ref={viewerRef} slide={slide} onViewportChange={handleViewportChange} />
          )}

          {/* Tissue heatmap overlay */}
          {viewerBounds && slide && (
            <TissueHeatmapLayer
              overlayId={overlayId}
              viewerBounds={viewerBounds}
              viewport={currentViewport}
              slideWidth={slide.width}
              slideHeight={slide.height}
              tileSize={overlayManifest?.tile_size ?? 256}
              levels={overlayManifest?.levels ?? 1}
              tissueClasses={DEFAULT_TISSUE_CLASSES}
              visibleClasses={visibleTissueClasses}
              opacity={tissueOpacity}
              enabled={tissueEnabled}
            />
          )}

          {/* Cell polygon overlay */}
          {viewerBounds && slide && (
            <OverlayCanvas
              cells={overlayCells}
              viewerBounds={viewerBounds}
              viewport={currentViewport}
              slideWidth={slide.width}
              slideHeight={slide.height}
              cellClasses={DEFAULT_CELL_CLASSES}
              visibleClasses={visibleCellClasses}
              opacity={cellsOpacity}
              enabled={cellsEnabled && overlayCells.length > 0}
            />
          )}

          {/* Cell hover tooltip */}
          {viewerBounds && slide && overlayCells.length > 0 && (
            <CellTooltip
              cells={overlayCells}
              cellClasses={DEFAULT_CELL_CLASSES}
              viewerBounds={viewerBounds}
              viewport={currentViewport}
              slideWidth={slide.width}
              slideHeight={slide.height}
              enabled={cellsEnabled && cellHoverEnabled}
            />
          )}

          {/* Cursor overlay */}
          {session && viewerBounds && slide && (
            <CursorLayer
              cursors={cursors}
              viewerBounds={viewerBounds}
              viewport={currentViewport}
              slideWidth={slide.width}
              slideHeight={slide.height}
              currentUserId={currentUser?.id}
            />
          )}

          {/* Minimap overlay showing presenter viewport for followers */}
          {session && slide && !isPresenter && presenterViewport && (
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
                presenterViewport={{
                  centerX: presenterViewport.center_x,
                  centerY: presenterViewport.center_y,
                  zoom: presenterViewport.zoom,
                }}
                presenterInfo={session.presenter}
                currentViewport={currentViewport}
                minimapWidth={150}
                minimapHeight={150}
                slideAspectRatio={slide.width / slide.height}
                isPresenter={isPresenter}
                cursors={cursors.map((c) => ({
                  participant_id: c.participant_id,
                  name: c.name,
                  color: c.color,
                  x: c.x / slide.width,
                  y: c.y / slide.height,
                }))}
                currentUserId={currentUser?.id}
              />
            </div>
          )}

          {/* Return to presenter floating button (followers only, when diverged) */}
          {session && !isPresenter && hasDiverged && (
            <ReturnToPresenterButton
              onClick={handleReturnToPresenter}
              presenterName={session.presenter.name}
            />
          )}

          {/* Keyboard shortcuts hint */}
          <button
            onClick={() => setShowHelp(true)}
            className="absolute bottom-4 right-4 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Keyboard shortcuts (press ? for help)"
          >
            Press <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">?</kbd> for
            shortcuts
          </button>
        </main>
      </div>

      <SessionFooter
        session={session}
        connectionStatus={connectionStatus}
        latency={latency}
        currentViewport={currentViewport}
        footerCursorPos={footerCursorPos}
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
