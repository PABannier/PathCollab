import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import OpenSeadragon from 'openseadragon'

export interface SlideInfo {
  id: string
  name: string
  width: number
  height: number
  tileSize: number
  numLevels: number
  tileUrlTemplate: string
}

export interface SlideViewerHandle {
  setViewport: (
    viewport: { centerX: number; centerY: number; zoom: number },
    immediate?: boolean
  ) => void
}

interface SlideViewerProps {
  slide: SlideInfo
  showMinimap?: boolean
  minimapPosition?: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT'
  onViewportChange?: (viewport: { centerX: number; centerY: number; zoom: number }) => void
  onAnimationFrame?: (viewport: { centerX: number; centerY: number; zoom: number }) => void
  onTileLoadError?: (error: { level: number; x: number; y: number }) => void
}

export const SlideViewer = forwardRef<SlideViewerHandle, SlideViewerProps>(function SlideViewer(
  {
    slide,
    showMinimap = true,
    minimapPosition = 'BOTTOM_RIGHT',
    onViewportChange,
    onAnimationFrame,
    onTileLoadError,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [tileErrors, setTileErrors] = useState(0)

  // Store callbacks in refs to avoid recreating viewer when callbacks change
  const onViewportChangeRef = useRef(onViewportChange)
  const onAnimationFrameRef = useRef(onAnimationFrame)
  const onTileLoadErrorRef = useRef(onTileLoadError)

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
    onAnimationFrameRef.current = onAnimationFrame
    onTileLoadErrorRef.current = onTileLoadError
  }, [onViewportChange, onAnimationFrame, onTileLoadError])

  useImperativeHandle(
    ref,
    () => ({
      setViewport: (viewport, immediate = false) => {
        const viewer = viewerRef.current
        if (!viewer?.viewport) return

        const center = new OpenSeadragon.Point(viewport.centerX, viewport.centerY)
        viewer.viewport.zoomTo(viewport.zoom, undefined, immediate)
        viewer.viewport.panTo(center, immediate)
        viewer.viewport.applyConstraints()
      },
    }),
    []
  )

  // Create a custom tile source for our server's DZI-compatible tile API
  const createTileSource = useCallback((slideInfo: SlideInfo): OpenSeadragon.TileSource => {
    // Calculate maxLevel the same way as the server (DZI convention)
    // DZI: level 0 = 1x1 pixel, level maxLevel = full resolution
    const maxDim = Math.max(slideInfo.width, slideInfo.height)
    const maxLevel = Math.ceil(Math.log2(maxDim))

    // Calculate minLevel - the level where the entire image fits in one tile
    // At minLevel: max(width, height) * scale <= tileSize
    // scale = 2^(level - maxLevel), so: maxDim * 2^(minLevel - maxLevel) <= tileSize
    // minLevel >= maxLevel + log2(tileSize / maxDim)
    const minLevel = Math.max(0, Math.ceil(maxLevel + Math.log2(slideInfo.tileSize / maxDim)))

    // Create a TileSource configuration object
    // We use OpenSeadragon's native TileSource with custom getTileUrl
    const tileSource = {
      width: slideInfo.width,
      height: slideInfo.height,
      tileSize: slideInfo.tileSize,
      tileOverlap: 0,
      minLevel: minLevel,
      maxLevel: maxLevel,
      getTileUrl: function (level: number, x: number, y: number): string {
        return slideInfo.tileUrlTemplate
          .replace('{level}', String(level))
          .replace('{x}', String(x))
          .replace('{y}', String(y))
      },
    }

    return new OpenSeadragon.TileSource(tileSource)
  }, [])

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    const viewer = OpenSeadragon({
      element: containerRef.current,
      // Use OpenSeadragon CDN for navigation button images
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/',
      // Navigation controls
      showNavigationControl: true,
      navigationControlAnchor: OpenSeadragon.ControlAnchor.TOP_LEFT,
      showZoomControl: true,
      showHomeControl: true,
      showFullPageControl: false,
      showRotationControl: false,
      // Navigator (minimap) - let OpenSeadragon manage its own element
      showNavigator: showMinimap,
      navigatorPosition: minimapPosition,
      navigatorSizeRatio: 0.15,
      navigatorMaintainSizeRatio: true,
      navigatorAutoFade: false,
      // Gestures
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
        scrollToZoom: true,
      },
      gestureSettingsTouch: {
        pinchToZoom: true,
        flickEnabled: true,
      },
      // Animation
      animationTime: 0.3,
      blendTime: 0.1,
      // Constraints
      constrainDuringPan: true,
      maxZoomPixelRatio: 4,
      minZoomLevel: 0.1,
      visibilityRatio: 0.5,
      defaultZoomLevel: 0,
      // Rendering
      immediateRender: false,
      imageLoaderLimit: 5,
      // Tile error handling
      loadTilesWithAjax: true,
      ajaxWithCredentials: false,
      timeout: 30000,
    })

    viewerRef.current = viewer

    // Track tile loading progress
    let tilesLoaded = 0
    const failedTiles: Set<string> = new Set()

    // Handle tile load failures
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(viewer as any).addHandler('tile-load-failed', (event: any) => {
      const tile = event.tile
      const key = `${tile.level}-${tile.x}-${tile.y}`

      // Only count each tile failure once
      if (!failedTiles.has(key)) {
        failedTiles.add(key)
        setTileErrors((prev) => prev + 1)
        onTileLoadErrorRef.current?.({ level: tile.level, x: tile.x, y: tile.y })
      }
    })

    viewer.world.addHandler('add-item', () => {
      setIsLoading(true)
      setTileErrors(0)
      tilesLoaded = 0
      failedTiles.clear()
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(viewer as any).addHandler('tile-loaded', () => {
      tilesLoaded++
      setLoadingProgress(Math.min(100, tilesLoaded * 5))
      if (tilesLoaded > 10) {
        setIsLoading(false)
        setLoadingProgress(100)
      }
    })

    // Track viewport changes (throttled)
    let viewportTimeout: ReturnType<typeof setTimeout> | null = null
    viewer.addHandler('viewport-change', () => {
      if (!viewer.viewport) return

      // Throttle viewport updates to 10Hz
      if (viewportTimeout) return
      viewportTimeout = setTimeout(() => {
        viewportTimeout = null
        if (!viewer.viewport) return
        const center = viewer.viewport.getCenter()
        const zoom = viewer.viewport.getZoom()
        onViewportChangeRef.current?.({
          centerX: center.x,
          centerY: center.y,
          zoom,
        })
      }, 100)
    })

    // Real-time viewport updates during animation (60fps)
    viewer.addHandler('animation', () => {
      if (!viewer.viewport) return
      const center = viewer.viewport.getCenter()
      const zoom = viewer.viewport.getZoom()
      onAnimationFrameRef.current?.({
        centerX: center.x,
        centerY: center.y,
        zoom,
      })
    })

    // Handle resize
    const handleResize = () => {
      if (viewer.viewport) {
        viewer.viewport.resize()
        viewer.viewport.applyConstraints()
      }
    }
    window.addEventListener('resize', handleResize)

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (!viewer.viewport) return

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault()
          viewer.viewport.zoomBy(1.5)
          break
        case '-':
          e.preventDefault()
          viewer.viewport.zoomBy(0.67)
          break
        case '0':
          e.preventDefault()
          viewer.viewport.goHome()
          break
        case 'ArrowUp':
          e.preventDefault()
          viewer.viewport.panBy(new OpenSeadragon.Point(0, -0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          viewer.viewport.panBy(new OpenSeadragon.Point(0, 0.1))
          break
        case 'ArrowLeft':
          e.preventDefault()
          viewer.viewport.panBy(new OpenSeadragon.Point(-0.1, 0))
          break
        case 'ArrowRight':
          e.preventDefault()
          viewer.viewport.panBy(new OpenSeadragon.Point(0.1, 0))
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      if (viewportTimeout) clearTimeout(viewportTimeout)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
      viewer.destroy()
      viewerRef.current = null
    }
  }, [showMinimap, minimapPosition])

  // Load slide when slide prop changes
  useEffect(() => {
    if (!viewerRef.current) return

    const tileSource = createTileSource(slide)
    viewerRef.current.open(tileSource)
    setIsLoading(true)
    setLoadingProgress(0)
    setTileErrors(0)
  }, [slide, createTileSource])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" style={{ backgroundColor: '#1E1E1E' }} />

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded bg-black/70 px-3 py-2 text-sm text-white">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <span>Loading tiles... {loadingProgress}%</span>
        </div>
      )}

      {/* Tile error indicator */}
      {tileErrors > 0 && (
        <div className="absolute right-4 top-4 flex items-center gap-2 rounded bg-red-600/80 px-3 py-2 text-sm text-white">
          <span>{tileErrors} tile(s) failed to load</span>
        </div>
      )}
    </div>
  )
})
