import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { SlideViewerHandle } from '../components/viewer'
import { Sidebar, StatusBar } from '../components/layout'
import {
  ErrorBanner,
  FollowModeIndicator,
  KeyboardShortcutsHelp,
  NetworkErrorBanner,
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
    createSession,
    updateCursor,
    updateViewport,
    changeSlide,
    snapToPresenter,
    setIsFollowing,
    checkDivergence,
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
        />
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
