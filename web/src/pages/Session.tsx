import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { SlideViewer, type SlideInfo } from '../components/viewer'
import { CursorLayer } from '../components/viewer/CursorLayer'
import { OverlayCanvas } from '../components/viewer/OverlayCanvas'
import { TissueHeatmapLayer } from '../components/viewer/TissueHeatmapLayer'
import { LayerPanel } from '../components/viewer/LayerPanel'
import { MinimapOverlay } from '../components/viewer/MinimapOverlay'
import { CellTooltip } from '../components/viewer/CellTooltip'
import { OverlayUploader } from '../components/upload/OverlayUploader'
import { useSession } from '../hooks/useSession'
import { usePresence } from '../hooks/usePresence'

// Cell polygon data for rendering
interface CellPolygon {
  x: number
  y: number
  classId: number
  confidence: number
  vertices: number[]
}

// Cell class definition
interface CellClass {
  id: number
  name: string
  color: string
}

// Default cell classes (15 types)
const DEFAULT_CELL_CLASSES: CellClass[] = [
  { id: 0, name: 'Tumor', color: '#DC2626' },
  { id: 1, name: 'Stroma', color: '#EA580C' },
  { id: 2, name: 'Immune', color: '#CA8A04' },
  { id: 3, name: 'Necrosis', color: '#16A34A' },
  { id: 4, name: 'Other', color: '#0D9488' },
  { id: 5, name: 'Class 5', color: '#0891B2' },
  { id: 6, name: 'Class 6', color: '#2563EB' },
  { id: 7, name: 'Class 7', color: '#7C3AED' },
  { id: 8, name: 'Class 8', color: '#C026D3' },
  { id: 9, name: 'Class 9', color: '#DB2777' },
  { id: 10, name: 'Class 10', color: '#84CC16' },
  { id: 11, name: 'Class 11', color: '#06B6D4' },
  { id: 12, name: 'Class 12', color: '#8B5CF6' },
  { id: 13, name: 'Class 13', color: '#F43F5E' },
  { id: 14, name: 'Class 14', color: '#64748B' },
]

// Tissue class definition
interface TissueClass {
  id: number
  name: string
  color: string
}

// Default tissue classes (8 types)
const DEFAULT_TISSUE_CLASSES: TissueClass[] = [
  { id: 0, name: 'Tumor', color: '#EF4444' },
  { id: 1, name: 'Stroma', color: '#F59E0B' },
  { id: 2, name: 'Necrosis', color: '#6B7280' },
  { id: 3, name: 'Lymphocytes', color: '#3B82F6' },
  { id: 4, name: 'Mucus', color: '#A855F7' },
  { id: 5, name: 'Smooth Muscle', color: '#EC4899' },
  { id: 6, name: 'Adipose', color: '#FBBF24' },
  { id: 7, name: 'Background', color: '#E5E7EB' },
]

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

  // Overlay state
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [overlayCells, setOverlayCells] = useState<CellPolygon[]>([])
  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(0.7)
  const [visibleCellClasses, setVisibleCellClasses] = useState<number[]>(
    DEFAULT_CELL_CLASSES.map(c => c.id)
  )
  const [cellHoverEnabled, setCellHoverEnabled] = useState(true)

  // Tissue heatmap state
  const [tissueEnabled, setTissueEnabled] = useState(true)
  const [tissueOpacity, setTissueOpacity] = useState(0.5)
  const [visibleTissueClasses, setVisibleTissueClasses] = useState<number[]>(
    DEFAULT_TISSUE_CLASSES.map(c => c.id)
  )

  // Get secrets from URL hash fragment (not sent to server)
  const hashParams = useMemo(() => {
    const hash = window.location.hash.slice(1)
    return new URLSearchParams(hash)
  }, [])
  const joinSecret = hashParams.get('join') || searchParams.get('join') || undefined
  const presenterKey = hashParams.get('presenter') || searchParams.get('presenter') || undefined

  // Handle overlay loaded
  const handleOverlayLoaded = useCallback((id: string, _manifest?: unknown) => {
    setOverlayId(id)
    setNotification(`Overlay loaded: ${id}`)
    setTimeout(() => setNotification(null), 3000)
  }, [])

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
    onOverlayLoaded: handleOverlayLoaded,
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

  // Fetch overlay cells when viewport changes
  useEffect(() => {
    if (!overlayId || !overlayEnabled || !viewerBounds) return

    const fetchCells = async () => {
      // Calculate viewport bounds in slide coordinates
      const viewportWidth = 1 / currentViewport.zoom
      const viewportHeight = (viewerBounds.height / viewerBounds.width) / currentViewport.zoom

      const minX = (currentViewport.centerX - viewportWidth / 2) * slide.width
      const maxX = (currentViewport.centerX + viewportWidth / 2) * slide.width
      const minY = (currentViewport.centerY - viewportHeight / 2) * slide.height
      const maxY = (currentViewport.centerY + viewportHeight / 2) * slide.height

      // Determine which tiles to fetch based on zoom level
      // Cap level at numLevels - 1 to avoid requesting non-existent tiles
      const level = Math.max(0, Math.min(slide.numLevels - 1, Math.floor(Math.log2(currentViewport.zoom))))
      const tilesPerDim = Math.pow(2, level)
      const tileWidth = slide.width / tilesPerDim
      const tileHeight = slide.height / tilesPerDim

      const startTileX = Math.max(0, Math.floor(minX / tileWidth))
      const endTileX = Math.min(tilesPerDim - 1, Math.floor(maxX / tileWidth))
      const startTileY = Math.max(0, Math.floor(minY / tileHeight))
      const endTileY = Math.min(tilesPerDim - 1, Math.floor(maxY / tileHeight))

      // Fetch vector chunks for visible tiles
      const cells: CellPolygon[] = []
      const fetchPromises: Promise<void>[] = []

      for (let ty = startTileY; ty <= endTileY && ty <= startTileY + 2; ty++) {
        for (let tx = startTileX; tx <= endTileX && tx <= startTileX + 2; tx++) {
          // Capture tile coordinates for closure
          const tileX = tx
          const tileY = ty
          // Calculate tile origin in slide coordinates
          const tileOriginX = tileX * tileWidth
          const tileOriginY = tileY * tileHeight

          fetchPromises.push(
            fetch(`/api/overlay/${overlayId}/vec/${level}/${tileX}/${tileY}`)
              .then(res => res.ok ? res.json() : null)
              .then(data => {
                if (data?.cells) {
                  for (const cell of data.cells) {
                    // Cell x/y are relative to tile origin, convert to absolute slide coords
                    cells.push({
                      x: tileOriginX + cell.x,
                      y: tileOriginY + cell.y,
                      classId: cell.class_id,
                      confidence: cell.confidence / 255,
                      vertices: cell.vertices || [],
                    })
                  }
                }
              })
              .catch(() => {})
          )
        }
      }

      await Promise.all(fetchPromises)
      setOverlayCells(cells)
    }

    // Debounce the fetch to avoid too many requests
    const timeoutId = setTimeout(fetchCells, 100)
    return () => clearTimeout(timeoutId)
  }, [overlayId, overlayEnabled, currentViewport, viewerBounds, slide])

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
          {/* Overlay controls */}
          {overlayId && (
            <div className="flex items-center gap-2 border-r border-gray-600 pr-2 mr-2">
              {/* Tissue heatmap toggle */}
              <button
                onClick={() => setTissueEnabled(!tissueEnabled)}
                className={`rounded px-2 py-1 text-xs ${
                  tissueEnabled
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                }`}
                title="Toggle tissue heatmap"
              >
                Tissue
              </button>
              {tissueEnabled && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={tissueOpacity * 100}
                  onChange={(e) => setTissueOpacity(Number(e.target.value) / 100)}
                  className="w-12 h-1"
                  title={`Tissue opacity: ${Math.round(tissueOpacity * 100)}%`}
                />
              )}
              {/* Cell overlay toggle */}
              <button
                onClick={() => setOverlayEnabled(!overlayEnabled)}
                className={`rounded px-2 py-1 text-xs ${
                  overlayEnabled
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                }`}
                title="Toggle cell overlay"
              >
                Cells
              </button>
              {overlayEnabled && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={overlayOpacity * 100}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                  className="w-12 h-1"
                  title={`Cell opacity: ${Math.round(overlayOpacity * 100)}%`}
                />
              )}
            </div>
          )}
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
          {session && isPresenter && !overlayId && (
            <OverlayUploader
              sessionId={session.id}
              onUploadComplete={(id) => {
                setOverlayId(id)
                setNotification('Overlay uploaded successfully!')
                setTimeout(() => setNotification(null), 3000)
              }}
              onError={setError}
            />
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

        {/* Tissue heatmap overlay */}
        {viewerBounds && (
          <TissueHeatmapLayer
            overlayId={overlayId}
            viewerBounds={viewerBounds}
            viewport={currentViewport}
            slideWidth={slide.width}
            slideHeight={slide.height}
            tissueClasses={DEFAULT_TISSUE_CLASSES}
            visibleClasses={visibleTissueClasses}
            opacity={tissueOpacity}
            enabled={tissueEnabled}
          />
        )}

        {/* Cell polygon overlay */}
        {viewerBounds && (
          <OverlayCanvas
            cells={overlayCells}
            viewerBounds={viewerBounds}
            viewport={currentViewport}
            slideWidth={slide.width}
            slideHeight={slide.height}
            cellClasses={DEFAULT_CELL_CLASSES}
            visibleClasses={visibleCellClasses}
            opacity={overlayOpacity}
            enabled={overlayEnabled && overlayCells.length > 0}
          />
        )}

        {/* Cell hover tooltip */}
        {viewerBounds && overlayCells.length > 0 && (
          <CellTooltip
            cells={overlayCells}
            cellClasses={DEFAULT_CELL_CLASSES}
            viewerBounds={viewerBounds}
            viewport={currentViewport}
            slideWidth={slide.width}
            slideHeight={slide.height}
            enabled={overlayEnabled && cellHoverEnabled}
          />
        )}

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

        {/* Minimap overlay showing presenter viewport for followers */}
        {session && !isPresenter && presenterViewport && (
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

        {/* Layer control panel */}
        {overlayId && (
          <LayerPanel
            tissueEnabled={tissueEnabled}
            onTissueEnabledChange={setTissueEnabled}
            tissueOpacity={tissueOpacity}
            onTissueOpacityChange={setTissueOpacity}
            tissueClasses={DEFAULT_TISSUE_CLASSES}
            visibleTissueClasses={visibleTissueClasses}
            onVisibleTissueClassesChange={setVisibleTissueClasses}
            cellsEnabled={overlayEnabled}
            onCellsEnabledChange={setOverlayEnabled}
            cellsOpacity={overlayOpacity}
            onCellsOpacityChange={setOverlayOpacity}
            cellClasses={DEFAULT_CELL_CLASSES}
            visibleCellClasses={visibleCellClasses}
            onVisibleCellClassesChange={setVisibleCellClasses}
            cellHoverEnabled={cellHoverEnabled}
            onCellHoverEnabledChange={setCellHoverEnabled}
          />
        )}
      </main>
    </div>
  )
}
