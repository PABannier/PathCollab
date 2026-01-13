import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { SlideViewer, type SlideInfo } from '../components/viewer'
import { CursorLayer } from '../components/viewer/CursorLayer'
import { useSession } from '../hooks/useSession'
import { usePresence } from '../hooks/usePresence'

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
  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const [viewerBounds, setViewerBounds] = useState<DOMRect | null>(null)
  const [currentViewport, setCurrentViewport] = useState({ centerX: 0.5, centerY: 0.5, zoom: 1 })
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  // Get secrets from URL hash fragment (not sent to server)
  const hashParams = useMemo(() => {
    const hash = window.location.hash.slice(1)
    return new URLSearchParams(hash)
  }, [])
  const joinSecret = hashParams.get('join') || searchParams.get('join') || undefined
  const presenterKey = hashParams.get('presenter') || searchParams.get('presenter') || undefined

  // Session hook
  const {
    session,
    currentUser,
    isPresenter,
    connectionStatus,
    cursors,
    presenterViewport,
    secrets,
    createSession,
    updateCursor,
    updateViewport,
    snapToPresenter,
  } = useSession({
    sessionId,
    joinSecret,
    presenterKey,
    onError: setError,
  })

  // Get slide info from session or use demo slide
  const slide = useMemo((): SlideInfo => {
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
    return {
      ...DEMO_SLIDE_BASE,
      tileUrlTemplate: `/api/slide/${DEMO_SLIDE_BASE.id}/tile/{level}/{x}/{y}`,
    }
  }, [session?.slide])

  // Presence tracking
  const { startTracking, stopTracking, updateCursorPosition, convertToSlideCoords } = usePresence({
    enabled: !!session,
    cursorUpdateHz: 30,
    onCursorUpdate: updateCursor,
    slideWidth: slide.width,
    slideHeight: slide.height,
  })

  // Start cursor tracking when session is active
  useEffect(() => {
    if (session) {
      startTracking()
    }
    return () => stopTracking()
  }, [session, startTracking, stopTracking])

  // Update viewer bounds on resize
  useEffect(() => {
    const updateBounds = () => {
      if (viewerContainerRef.current) {
        setViewerBounds(viewerContainerRef.current.getBoundingClientRect())
      }
    }

    updateBounds()
    window.addEventListener('resize', updateBounds)
    return () => window.removeEventListener('resize', updateBounds)
  }, [])

  // Handle viewport changes
  const handleViewportChange = useCallback(
    (viewport: { centerX: number; centerY: number; zoom: number }) => {
      setCurrentViewport(viewport)
      // Only send viewport updates if we're in a session
      if (session) {
        updateViewport(viewport.centerX, viewport.centerY, viewport.zoom)
      }
    },
    [session, updateViewport]
  )

  // Handle mouse move for cursor tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!session || !viewerBounds) return

      const slideCoords = convertToSlideCoords(
        e.clientX,
        e.clientY,
        viewerBounds,
        currentViewport
      )

      if (slideCoords) {
        updateCursorPosition(slideCoords.x, slideCoords.y)
      }
    },
    [session, viewerBounds, currentViewport, convertToSlideCoords, updateCursorPosition]
  )

  // Handle create session
  const handleCreateSession = useCallback(() => {
    createSession('demo')
  }, [createSession])

  // Handle snap to presenter
  const handleSnapToPresenter = useCallback(() => {
    snapToPresenter()
  }, [snapToPresenter])

  // Build share URL when session is created with secrets
  useEffect(() => {
    if (session && secrets) {
      // Build share URL with join secret in hash (not sent to server)
      const baseUrl = `${window.location.origin}/s/${session.id}#join=${secrets.joinSecret}`
      setShareUrl(baseUrl)
    }
  }, [session, secrets])

  // Handle share link
  const handleShare = useCallback(async () => {
    if (!shareUrl && !session) return

    const url = shareUrl || window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setNotification('Link copied to clipboard!')
      setTimeout(() => setNotification(null), 2000)
    } catch {
      setError('Failed to copy link')
    }
  }, [shareUrl, session])

  // Connection status indicator
  const connectionIndicator = useMemo(() => {
    switch (connectionStatus) {
      case 'connected':
        return <span className="h-2 w-2 rounded-full bg-green-500" title="Connected" />
      case 'connecting':
      case 'reconnecting':
        return <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" title="Connecting" />
      case 'disconnected':
        return <span className="h-2 w-2 rounded-full bg-red-500" title="Disconnected" />
    }
  }, [connectionStatus])

  // Participant count
  const participantCount = session ? 1 + session.followers.length : 0

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">PathCollab</h1>
          {session ? (
            <>
              <span className="text-sm text-gray-400">Session: {session.id}</span>
              <span className="flex items-center gap-1 text-sm text-gray-400">
                {connectionIndicator}
                {participantCount} viewer{participantCount !== 1 ? 's' : ''}
              </span>
              {isPresenter && (
                <span className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">Presenter</span>
              )}
            </>
          ) : (
            <span className="text-sm text-gray-400">
              {sessionId ? `Session: ${sessionId}` : 'No session'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!session && connectionStatus === 'connected' && (
            <button
              onClick={handleCreateSession}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
            >
              Create Session
            </button>
          )}
          {session && !isPresenter && presenterViewport && (
            <button
              onClick={handleSnapToPresenter}
              className="rounded bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700"
            >
              Follow Presenter
            </button>
          )}
          {session && (
            <button
              onClick={handleShare}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              Share
            </button>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-600 px-4 py-2 text-sm text-white">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Notification banner */}
      {notification && (
        <div className="bg-green-600 px-4 py-2 text-sm text-white">
          {notification}
        </div>
      )}

      {/* Main viewer area */}
      <main className="relative flex-1 overflow-hidden" ref={viewerContainerRef} onMouseMove={handleMouseMove}>
        <SlideViewer slide={slide} onViewportChange={handleViewportChange} />

        {/* Cursor overlay */}
        {session && viewerBounds && (
          <CursorLayer
            cursors={cursors}
            viewerBounds={viewerBounds}
            viewport={currentViewport}
            slideWidth={slide.width}
            slideHeight={slide.height}
            currentUserId={currentUser?.id}
          />
        )}

        {/* Participant list (inside main for proper positioning) */}
        {session && session.followers.length > 0 && (
          <div className="absolute bottom-4 left-4 rounded bg-black/70 p-2 text-xs text-white">
            <div className="mb-1 font-semibold">Participants:</div>
            <div className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: session.presenter.color }}
              />
              <span>{session.presenter.name} (Presenter)</span>
            </div>
            {session.followers.map((f) => (
              <div key={f.id} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} />
                <span>{f.name}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
