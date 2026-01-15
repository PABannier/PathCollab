import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { SlideViewer, type SlideInfo, type SlideViewerHandle } from '../components/viewer'
import { CursorLayer } from '../components/viewer/CursorLayer'
import { OverlayCanvas } from '../components/viewer/OverlayCanvas'
import { TissueHeatmapLayer } from '../components/viewer/TissueHeatmapLayer'
import { LayerPanel } from '../components/viewer/LayerPanel'
import { MinimapOverlay } from '../components/viewer/MinimapOverlay'
import { CellTooltip } from '../components/viewer/CellTooltip'
import { OverlayUploader } from '../components/upload/OverlayUploader'
import { Sidebar, SidebarSection } from '../components/layout'
import { StatusBar, ConnectionBadge } from '../components/layout'
import {
  Button,
  KeyboardShortcutsHelp,
  NetworkErrorBanner,
  PresetEmptyState,
  Toggle,
} from '../components/ui'
import { useSession, type LayerVisibility, type OverlayManifest } from '../hooks/useSession'
import { usePresence } from '../hooks/usePresence'
import { useDefaultSlide } from '../hooks/useDefaultSlide'
import { useKeyboardShortcuts, type KeyboardShortcut } from '../hooks/useKeyboardShortcuts'

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
  const viewerRef = useRef<SlideViewerHandle | null>(null)
  const [viewerBounds, setViewerBounds] = useState<DOMRect | null>(null)
  const [currentViewport, setCurrentViewport] = useState({ centerX: 0.5, centerY: 0.5, zoom: 1 })
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle')
  const pendingSnapRef = useRef(false)
  const autoCreateRequestedRef = useRef(false)

  // Overlay state
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [overlayManifest, setOverlayManifest] = useState<OverlayManifest | null>(null)
  const [overlayCells, setOverlayCells] = useState<CellPolygon[]>([])
  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(0.7)
  const [visibleCellClasses, setVisibleCellClasses] = useState<number[]>(
    DEFAULT_CELL_CLASSES.map((c) => c.id)
  )
  const [cellHoverEnabled, setCellHoverEnabled] = useState(true)

  // Tissue heatmap state
  const [tissueEnabled, setTissueEnabled] = useState(true)
  const [tissueOpacity, setTissueOpacity] = useState(0.5)
  const [visibleTissueClasses, setVisibleTissueClasses] = useState<number[]>(
    DEFAULT_TISSUE_CLASSES.map((c) => c.id)
  )

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

  // Handle overlay loaded
  const handleOverlayLoaded = useCallback((id: string, manifest: OverlayManifest) => {
    setOverlayId(id)
    setOverlayManifest(manifest)
    setNotification(`Overlay loaded: ${id}`)
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Session hook
  const {
    session,
    currentUser,
    isPresenter,
    isCreatingSession,
    connectionStatus,
    cursors,
    presenterViewport,
    secrets,
    isFollowing,
    createSession,
    updateCursor,
    updateViewport,
    updateLayerVisibility,
    snapToPresenter,
    setIsFollowing,
  } = useSession({
    sessionId,
    joinSecret,
    presenterKey,
    onError: setError,
    onOverlayLoaded: handleOverlayLoaded,
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

  const layerVisibility = useMemo<LayerVisibility>(
    () => ({
      tissue_heatmap_visible: tissueEnabled,
      tissue_heatmap_opacity: tissueOpacity,
      tissue_classes_visible: visibleTissueClasses,
      cell_polygons_visible: overlayEnabled,
      cell_polygons_opacity: overlayOpacity,
      cell_classes_visible: visibleCellClasses,
      cell_hover_enabled: cellHoverEnabled,
    }),
    [
      tissueEnabled,
      tissueOpacity,
      visibleTissueClasses,
      overlayEnabled,
      overlayOpacity,
      visibleCellClasses,
      cellHoverEnabled,
    ]
  )

  const emitLayerVisibility = useCallback(
    (next: LayerVisibility) => {
      if (session && isPresenter) {
        updateLayerVisibility(next)
      }
    },
    [isPresenter, session, updateLayerVisibility]
  )

  const handleTissueEnabledChange = useCallback(
    (enabled: boolean) => {
      setTissueEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, tissue_heatmap_visible: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleTissueOpacityChange = useCallback(
    (opacity: number) => {
      setTissueOpacity(opacity)
      emitLayerVisibility({ ...layerVisibility, tissue_heatmap_opacity: opacity })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleVisibleTissueClassesChange = useCallback(
    (classes: number[]) => {
      setVisibleTissueClasses(classes)
      emitLayerVisibility({ ...layerVisibility, tissue_classes_visible: classes })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleCellsEnabledChange = useCallback(
    (enabled: boolean) => {
      setOverlayEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, cell_polygons_visible: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleCellsOpacityChange = useCallback(
    (opacity: number) => {
      setOverlayOpacity(opacity)
      emitLayerVisibility({ ...layerVisibility, cell_polygons_opacity: opacity })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleVisibleCellClassesChange = useCallback(
    (classes: number[]) => {
      setVisibleCellClasses(classes)
      emitLayerVisibility({ ...layerVisibility, cell_classes_visible: classes })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const handleCellHoverEnabledChange = useCallback(
    (enabled: boolean) => {
      setCellHoverEnabled(enabled)
      emitLayerVisibility({ ...layerVisibility, cell_hover_enabled: enabled })
    },
    [emitLayerVisibility, layerVisibility]
  )

  const layerControlsDisabled = !!session && !isPresenter

  const arraysEqual = useCallback((a: number[], b: number[]) => {
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
  }, [])

  const applyLayerVisibility = useCallback(
    (visibility: LayerVisibility) => {
      setTissueEnabled((prev) =>
        prev === visibility.tissue_heatmap_visible ? prev : visibility.tissue_heatmap_visible
      )
      setTissueOpacity((prev) =>
        prev === visibility.tissue_heatmap_opacity ? prev : visibility.tissue_heatmap_opacity
      )
      setVisibleTissueClasses((prev) =>
        arraysEqual(prev, visibility.tissue_classes_visible)
          ? prev
          : visibility.tissue_classes_visible
      )
      setOverlayEnabled((prev) =>
        prev === visibility.cell_polygons_visible ? prev : visibility.cell_polygons_visible
      )
      setOverlayOpacity((prev) =>
        prev === visibility.cell_polygons_opacity ? prev : visibility.cell_polygons_opacity
      )
      setVisibleCellClasses((prev) =>
        arraysEqual(prev, visibility.cell_classes_visible) ? prev : visibility.cell_classes_visible
      )
      setCellHoverEnabled((prev) =>
        prev === visibility.cell_hover_enabled ? prev : visibility.cell_hover_enabled
      )
    },
    [arraysEqual]
  )

  useEffect(() => {
    if (!session?.layer_visibility) return
    // Sync local layer state with session state from server
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyLayerVisibility(session.layer_visibility)
  }, [applyLayerVisibility, session?.layer_visibility])

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

  // Fetch overlay cells when viewport changes
  useEffect(() => {
    if (!overlayId || !overlayEnabled || !viewerBounds || !slide) return

    // AbortController to cancel in-flight requests when viewport changes
    const abortController = new AbortController()

    const fetchCells = async () => {
      // Calculate viewport bounds in slide coordinates (pixels)
      const viewportWidth = 1 / currentViewport.zoom
      const viewportHeight = viewerBounds.height / viewerBounds.width / currentViewport.zoom

      const minX = (currentViewport.centerX - viewportWidth / 2) * slide.width
      const maxX = (currentViewport.centerX + viewportWidth / 2) * slide.width
      const minY = (currentViewport.centerY - viewportHeight / 2) * slide.height
      const maxY = (currentViewport.centerY + viewportHeight / 2) * slide.height

      // Server stores vector chunks at level 0 using the overlay tile grid.
      const serverTileSize = overlayManifest?.tile_size ?? 256
      const level = 0

      // Calculate tile range using the server's tile grid
      const maxTileX = Math.max(0, Math.ceil(slide.width / serverTileSize) - 1)
      const maxTileY = Math.max(0, Math.ceil(slide.height / serverTileSize) - 1)
      const startTileX = Math.max(0, Math.floor(minX / serverTileSize))
      const endTileX = Math.min(maxTileX, Math.floor(maxX / serverTileSize))
      const startTileY = Math.max(0, Math.floor(minY / serverTileSize))
      const endTileY = Math.min(maxTileY, Math.floor(maxY / serverTileSize))

      // Fetch vector chunks for visible tiles
      const cells: CellPolygon[] = []
      const fetchPromises: Promise<void>[] = []

      // Limit tile fetches to prevent excessive requests at low zoom
      const maxTilesPerAxis = 4
      const centerTileX = Math.floor((minX + maxX) / 2 / serverTileSize)
      const centerTileY = Math.floor((minY + maxY) / 2 / serverTileSize)
      let rangeStartX = startTileX
      let rangeEndX = endTileX
      let rangeStartY = startTileY
      let rangeEndY = endTileY

      if (endTileX - startTileX + 1 > maxTilesPerAxis) {
        rangeStartX = Math.max(0, centerTileX - Math.floor(maxTilesPerAxis / 2))
        rangeEndX = Math.min(maxTileX, rangeStartX + maxTilesPerAxis - 1)
        rangeStartX = Math.max(0, rangeEndX - maxTilesPerAxis + 1)
      }

      if (endTileY - startTileY + 1 > maxTilesPerAxis) {
        rangeStartY = Math.max(0, centerTileY - Math.floor(maxTilesPerAxis / 2))
        rangeEndY = Math.min(maxTileY, rangeStartY + maxTilesPerAxis - 1)
        rangeStartY = Math.max(0, rangeEndY - maxTilesPerAxis + 1)
      }

      for (let ty = rangeStartY; ty <= rangeEndY; ty++) {
        for (let tx = rangeStartX; tx <= rangeEndX; tx++) {
          // Capture tile coordinates for closure
          const tileX = tx
          const tileY = ty
          // Calculate tile origin in slide coordinates using server's tile size
          const tileOriginX = tileX * serverTileSize
          const tileOriginY = tileY * serverTileSize

          fetchPromises.push(
            fetch(`/api/overlay/${overlayId}/vec/${level}/${tileX}/${tileY}`, {
              signal: abortController.signal,
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.cells) {
                  for (const cell of data.cells) {
                    // Cell x/y are relative to tile origin (in pixels), convert to absolute slide coords
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
              .catch((err) => {
                // Ignore abort errors - they're expected when viewport changes
                if (err.name !== 'AbortError') {
                  // Silently ignore other fetch errors (network issues, 404s, etc.)
                }
              })
          )
        }
      }

      await Promise.all(fetchPromises)
      // Only update state if the request wasn't aborted
      if (!abortController.signal.aborted) {
        setOverlayCells(cells)
      }
    }

    // Debounce the fetch to avoid too many requests
    const timeoutId = setTimeout(fetchCells, 100)
    return () => {
      clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [overlayId, overlayEnabled, currentViewport, viewerBounds, slide, overlayManifest])

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

  const applyPresenterViewport = useCallback(
    (viewport: { center_x: number; center_y: number; zoom: number }) => {
      viewerRef.current?.setViewport({
        centerX: viewport.center_x,
        centerY: viewport.center_y,
        zoom: viewport.zoom,
      })
    },
    []
  )

  // Handle mouse move for cursor tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!session || !viewerBounds) return

      const slideCoords = convertToSlideCoords(e.clientX, e.clientY, viewerBounds, currentViewport)

      if (slideCoords) {
        updateCursorPosition(slideCoords.x, slideCoords.y)
      }
    },
    [session, viewerBounds, currentViewport, convertToSlideCoords, updateCursorPosition]
  )

  // Handle snap to presenter
  const handleSnapToPresenter = useCallback(() => {
    pendingSnapRef.current = true
    snapToPresenter()
    if (presenterViewport) {
      applyPresenterViewport(presenterViewport)
    }
  }, [applyPresenterViewport, presenterViewport, snapToPresenter])

  useEffect(() => {
    if (!pendingSnapRef.current || !presenterViewport) return
    applyPresenterViewport(presenterViewport)
    pendingSnapRef.current = false
  }, [applyPresenterViewport, presenterViewport])

  // Auto-follow presenter viewport when following is enabled
  // This ref tracks the last applied viewport to avoid re-applying the same one
  const lastAppliedViewportRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isFollowing || isPresenter || !presenterViewport) return

    // Create a unique key for this viewport to detect changes
    const viewportKey = `${presenterViewport.center_x}-${presenterViewport.center_y}-${presenterViewport.zoom}-${presenterViewport.timestamp}`

    // Only apply if this is a new viewport (avoid duplicate applications)
    if (lastAppliedViewportRef.current === viewportKey) return
    lastAppliedViewportRef.current = viewportKey

    applyPresenterViewport(presenterViewport)
  }, [isFollowing, isPresenter, presenterViewport, applyPresenterViewport])

  // Build share URL when session is created with secrets
  useEffect(() => {
    if (session && secrets) {
      // Build share URL with join secret in hash (not sent to server)
      const baseUrl = `${window.location.origin}/s/${session.id}#join=${secrets.joinSecret}`
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShareUrl(baseUrl)
    }
  }, [session, secrets])

  // Track pending copy request (for auto-copy after session creation)
  const pendingCopyRef = useRef(false)

  // Handle share link - auto-creates session if needed
  const handleShare = useCallback(async () => {
    if (copyState === 'success') return // Prevent rapid double-clicks

    // If no session, auto-create one and mark pending copy
    if (!session && slide) {
      pendingCopyRef.current = true
      createSession(slide.id)
      return
    }

    const url = shareUrl || window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('success')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 3000)
    }
  }, [shareUrl, session, slide, copyState, createSession])

  // Auto-copy share URL when session is created after Copy Link click
  useEffect(() => {
    if (!pendingCopyRef.current || !shareUrl) return
    pendingCopyRef.current = false

    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopyState('success')
        setTimeout(() => setCopyState('idle'), 2000)
      })
      .catch(() => {
        setCopyState('error')
        setTimeout(() => setCopyState('idle'), 3000)
      })
  }, [shareUrl])

  // Handle zoom reset
  const handleZoomReset = useCallback(() => {
    viewerRef.current?.setViewport({ centerX: 0.5, centerY: 0.5, zoom: 1 })
  }, [])

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
          {/* Follow presenter toggle (followers only) */}
          {session && !isPresenter && (
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-sm font-medium text-gray-300">Follow presenter</span>
                <p className="text-xs text-gray-500">Sync your view automatically</p>
              </div>
              <Toggle
                checked={isFollowing}
                onChange={setIsFollowing}
                aria-label="Follow presenter"
                size="sm"
              />
            </div>
          )}

          {/* Connection status */}
          {!isSoloMode && (
            <div className="mb-4 flex items-center gap-2">
              <ConnectionBadge status={connectionStatus} />
              <span className="text-gray-400 italic text-sm">
                {connectionStatus === 'connected'
                  ? 'You are connected'
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : connectionStatus === 'reconnecting'
                      ? 'Reconnecting...'
                      : 'Disconnected'}
              </span>
            </div>
          )}

          {/* Share Link section */}
          {slide && !isSoloMode && (
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
                  style={{ backgroundColor: '#3C3C3C' }}
                >
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: session.presenter.color }}
                  />
                  <span className="text-gray-300">{session.presenter.name}</span>
                  <span className="text-gray-500 ml-auto">(host)</span>
                </div>
                {session.followers.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                    style={{ backgroundColor: '#3C3C3C' }}
                  >
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: f.color }}
                    />
                    <span className="text-gray-300">{f.name}</span>
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
              <div className="space-y-3">
                {/* Tissue heatmap controls */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={tissueEnabled}
                        onChange={(e) => handleTissueEnabledChange(e.target.checked)}
                        disabled={layerControlsDisabled}
                        className="rounded"
                      />
                      Tissue Heatmap
                    </label>
                    {tissueEnabled && (
                      <span className="text-xs text-gray-500">
                        {Math.round(tissueOpacity * 100)}%
                      </span>
                    )}
                  </div>
                  {tissueEnabled && (
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={tissueOpacity * 100}
                      onChange={(e) => handleTissueOpacityChange(Number(e.target.value) / 100)}
                      className="w-full h-1"
                      disabled={layerControlsDisabled}
                    />
                  )}
                </div>
                {/* Cell overlay controls */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={overlayEnabled}
                        onChange={(e) => handleCellsEnabledChange(e.target.checked)}
                        disabled={layerControlsDisabled}
                        className="rounded"
                      />
                      Cell Polygons
                    </label>
                    {overlayEnabled && (
                      <span className="text-xs text-gray-500">
                        {Math.round(overlayOpacity * 100)}%
                      </span>
                    )}
                  </div>
                  {overlayEnabled && (
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={overlayOpacity * 100}
                      onChange={(e) => handleCellsOpacityChange(Number(e.target.value) / 100)}
                      className="w-full h-1"
                      disabled={layerControlsDisabled}
                    />
                  )}
                </div>
                {/* Cell hover toggle */}
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={cellHoverEnabled}
                    onChange={(e) => handleCellHoverEnabledChange(e.target.checked)}
                    disabled={layerControlsDisabled}
                    className="rounded"
                  />
                  Show cell info on hover
                </label>
                {layerControlsDisabled && (
                  <p className="text-xs text-gray-500 italic">
                    Layer controls managed by presenter
                  </p>
                )}
              </div>
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
        >
          {/* Show loading or empty state while waiting for slide */}
          {!slide && (
            <div className="flex h-full items-center justify-center bg-gray-900">
              {connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? (
                <PresetEmptyState preset="connecting" />
              ) : isLoadingDefaultSlide || isCreatingSession ? (
                <PresetEmptyState preset="loading" />
              ) : (
                <PresetEmptyState preset="no-slides" />
              )}
            </div>
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
              opacity={overlayOpacity}
              enabled={overlayEnabled && overlayCells.length > 0}
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
              enabled={overlayEnabled && cellHoverEnabled}
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

          {/* Layer control panel (detailed class toggles) */}
          {overlayId && (
            <LayerPanel
              tissueEnabled={tissueEnabled}
              onTissueEnabledChange={handleTissueEnabledChange}
              tissueOpacity={tissueOpacity}
              onTissueOpacityChange={handleTissueOpacityChange}
              tissueClasses={DEFAULT_TISSUE_CLASSES}
              visibleTissueClasses={visibleTissueClasses}
              onVisibleTissueClassesChange={handleVisibleTissueClassesChange}
              cellsEnabled={overlayEnabled}
              onCellsEnabledChange={handleCellsEnabledChange}
              cellsOpacity={overlayOpacity}
              onCellsOpacityChange={handleCellsOpacityChange}
              cellClasses={DEFAULT_CELL_CLASSES}
              visibleCellClasses={visibleCellClasses}
              onVisibleCellClassesChange={handleVisibleCellClassesChange}
              cellHoverEnabled={cellHoverEnabled}
              onCellHoverEnabledChange={handleCellHoverEnabledChange}
              disabled={layerControlsDisabled}
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

      {/* Bottom status bar (VS Code style) */}
      <footer className="flex items-center h-6 text-xs" style={{ backgroundColor: '#111111' }}>
        {/* Left section with blue background */}
        <div
          className="flex items-center gap-1.5 px-2 h-full"
          style={{ backgroundColor: '#007ACC' }}
        >
          {/* Connected icon */}
          <svg
            className="w-3.5 h-3.5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
            />
          </svg>
          <span className="text-white font-medium">
            {session ? session.id.slice(0, 8) : 'No Session'}
          </span>
        </div>
        {/* Right section - black background (flex-1 fills the rest) */}
        <div className="flex-1 px-2" />
      </footer>

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
