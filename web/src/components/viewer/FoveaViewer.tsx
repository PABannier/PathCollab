import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FoveaViewer as FoveaEngine } from '@fovea/viewer'
import {
  type CellClass,
  type OsdViewport,
  buildCellClassColors,
  buildCellClassVisibility,
  foveaCellsUrl,
  foveaHeatmapUrl,
  foveaSlideUrl,
  foveaToOsd,
  osdToFovea,
} from './foveaViewport'

/** Slide info — unchanged shape; only `id`/`width`/`height` are used by fovea. */
export interface SlideInfo {
  id: string
  name: string
  width: number
  height: number
  tileSize: number
  numLevels: number
  tileUrlTemplate: string
}

/** Imperative handle. `setViewport` keeps the old OpenSeadragon signature so
 *  presenter-follow / snap / divergence (useViewerViewport) is untouched.
 *  `slideToScreen`/`screenToSlide` expose fovea's exact camera transforms so the
 *  collaboration layer (cursors) maps positions identically to what fovea renders,
 *  independent of any container/canvas-bounds reconstruction. */
export interface SlideViewerHandle {
  setViewport: (
    viewport: { centerX: number; centerY: number; zoom: number },
    immediate?: boolean
  ) => void
  /** Slide-pixel → canvas-relative CSS pixels. Null until the engine is ready. */
  slideToScreen: (slideX: number, slideY: number) => { x: number; y: number } | null
  /** Page (clientX/clientY) CSS pixels → slide-pixel. Null until the engine is ready. */
  screenToSlide: (clientX: number, clientY: number) => { x: number; y: number } | null
}

interface FoveaViewerProps {
  slide: SlideInfo
  onViewportChange?: (viewport: OsdViewport) => void
  onAnimationFrame?: (viewport: OsdViewport) => void
  /** Cell overlay controls (rendered inside fovea). */
  cellOverlaysEnabled?: boolean
  cellOverlayOpacity?: number
  visibleCellTypes?: Set<string>
  cellClasses?: CellClass[]
  /** Tissue overlay = fovea density heatmap; only enable + opacity. */
  tissueOverlaysEnabled?: boolean
  tissueOverlayOpacity?: number
}

const webGpuSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu

export const FoveaViewer = forwardRef<SlideViewerHandle, FoveaViewerProps>(function FoveaViewer(
  {
    slide,
    onViewportChange,
    onAnimationFrame,
    cellOverlaysEnabled,
    cellOverlayOpacity,
    visibleCellTypes,
    cellClasses,
    tissueOverlaysEnabled,
    tissueOverlayOpacity,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<FoveaEngine | null>(null)
  const [ready, setReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [unsupported] = useState(() => !webGpuSupported())

  // Live refs so the (stable) engine event handlers read current values.
  const slideWidthRef = useRef(slide.width)
  const onViewportChangeRef = useRef(onViewportChange)
  const onAnimationFrameRef = useRef(onAnimationFrame)
  useEffect(() => {
    slideWidthRef.current = slide.width
    onViewportChangeRef.current = onViewportChange
    onAnimationFrameRef.current = onAnimationFrame
  }, [slide.width, onViewportChange, onAnimationFrame])

  const canvasCssWidth = (): number =>
    canvasRef.current?.getBoundingClientRect().width || slideWidthRef.current

  // Imperative handle: accept OSD-normalized viewport, apply to fovea camera.
  useImperativeHandle(
    ref,
    () => ({
      setViewport: (viewport) => {
        const engine = engineRef.current
        if (!engine) return
        const cam = osdToFovea(viewport, slideWidthRef.current, canvasCssWidth())
        engine.setCamera(cam.centerX, cam.centerY, cam.zoom)
      },
      slideToScreen: (slideX, slideY) => {
        const engine = engineRef.current
        if (!engine) return null
        // fovea returns canvas-relative CSS pixels, which is also the cursor
        // overlay's coordinate space (it fills the same box as the canvas).
        return engine.slideToScreen(slideX, slideY)
      },
      screenToSlide: (clientX, clientY) => {
        const engine = engineRef.current
        const canvas = canvasRef.current
        if (!engine || !canvas) return null
        const rect = canvas.getBoundingClientRect()
        return engine.screenToSlide(clientX - rect.left, clientY - rect.top)
      },
    }),
    []
  )

  // Create the engine once. Guards React 19 StrictMode double-mount.
  useEffect(() => {
    if (unsupported) return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let throttle: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      let engine: FoveaEngine
      try {
        engine = await FoveaEngine.create({ canvas })
      } catch (err) {
        console.error('FoveaViewer: failed to create engine', err)
        return
      }
      if (cancelled) {
        engine.destroy()
        return
      }
      engineRef.current = engine

      unsubscribe = engine.on('viewport-change', (cam) => {
        const vp = foveaToOsd(cam, slideWidthRef.current, canvasCssWidth())
        onAnimationFrameRef.current?.(vp)
        if (throttle) return
        throttle = setTimeout(() => {
          throttle = null
          onViewportChangeRef.current?.(vp)
        }, 100)
      })

      engine.start()
      setReady(true)
    })()

    return () => {
      cancelled = true
      if (throttle) clearTimeout(throttle)
      unsubscribe?.()
      engineRef.current?.destroy()
      engineRef.current = null
      setReady(false)
    }
  }, [unsupported])

  // Load slide + overlays when the slide changes.
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current
    if (!engine) return

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading on slide change
    setIsLoading(true)

    // Keep the "Loading slide…" indicator up until the slide manifest resolves
    // (the first request also triggers the server-side prepare, which can take a
    // while for a large overlay). Tiles then stream in over subsequent frames.
    void engine
      .loadSlide(foveaSlideUrl(slide.id))
      .then(() => {
        if (!cancelled) setIsLoading(false)
      })
      .catch((err) => {
        console.error('FoveaViewer: failed to load slide', err)
        if (!cancelled) setIsLoading(false)
      })
    // Cells/heatmap are optional — a slide without an overlay returns 404.
    void engine.loadCells(foveaCellsUrl(slide.id)).catch(() => {})
    void engine.loadHeatmap(foveaHeatmapUrl(slide.id)).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [ready, slide.id])

  // --- Overlay style/visibility sync (cells) ---
  useEffect(() => {
    if (!ready) return
    engineRef.current?.setLayerVisibility('cells', !!cellOverlaysEnabled)
  }, [ready, cellOverlaysEnabled])

  useEffect(() => {
    if (!ready || cellOverlayOpacity == null) return
    engineRef.current?.setLayerOpacity('cells', cellOverlayOpacity)
  }, [ready, cellOverlayOpacity])

  useEffect(() => {
    if (!ready || !cellClasses || cellClasses.length === 0) return
    engineRef.current?.setCellClassColors(buildCellClassColors(cellClasses))
  }, [ready, cellClasses])

  useEffect(() => {
    if (!ready || !cellClasses || cellClasses.length === 0) return
    const visible = visibleCellTypes ?? new Set<string>()
    engineRef.current?.setCellClassVisibility(buildCellClassVisibility(cellClasses, visible))
  }, [ready, cellClasses, visibleCellTypes])

  // --- Overlay style/visibility sync (tissue = density heatmap) ---
  useEffect(() => {
    if (!ready) return
    engineRef.current?.setLayerVisibility('heatmap', !!tissueOverlaysEnabled)
  }, [ready, tissueOverlaysEnabled])

  useEffect(() => {
    if (!ready || tissueOverlayOpacity == null) return
    engineRef.current?.setLayerOpacity('heatmap', tissueOverlayOpacity)
  }, [ready, tissueOverlayOpacity])

  // --- Navigation controls (replace OSD's built-in zoom/home buttons) ---
  const zoomByFactor = useRef((factor: number) => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas) return
    const rect = canvas.getBoundingClientRect()
    // fovea zoomAt factor = exp(-wheelDelta * 0.001) → wheelDelta = -ln(factor)*1000
    const wheelDelta = -Math.log(factor) * 1000
    engine.zoomAtCanvasPoint(rect.width / 2, rect.height / 2, wheelDelta)
  })
  const goHome = useRef(() => engineRef.current?.resetCamera())
  const panByViewportFraction = useRef((fx: number, fy: number) => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas) return
    const step = 0.1 * canvas.getBoundingClientRect().width
    engine.panByScreenDelta(fx * step, fy * step)
  })

  useEffect(() => {
    if (!ready) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault()
          zoomByFactor.current(1.5)
          break
        case '-':
          e.preventDefault()
          zoomByFactor.current(0.667)
          break
        case '0':
          e.preventDefault()
          goHome.current()
          break
        case 'ArrowUp':
          e.preventDefault()
          panByViewportFraction.current(0, 1)
          break
        case 'ArrowDown':
          e.preventDefault()
          panByViewportFraction.current(0, -1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          panByViewportFraction.current(1, 0)
          break
        case 'ArrowRight':
          e.preventDefault()
          panByViewportFraction.current(-1, 0)
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ready])

  if (unsupported) {
    return (
      <div className="relative h-full w-full">
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ backgroundColor: '#1E1E1E' }}
        >
          <div className="max-w-md px-6 text-center text-gray-300">
            <h2 className="mb-2 text-lg font-semibold text-white">WebGPU required</h2>
            <p className="text-sm">
              PathCollab&apos;s viewer uses WebGPU, which this browser does not support. Please use
              a recent version of Chrome, Edge, or Safari 18+ to view slides.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ backgroundColor: '#1E1E1E', touchAction: 'none', display: 'block' }}
      />

      {/* Zoom / home controls (replace OpenSeadragon's built-in navigation) */}
      <div className="absolute left-2 top-2 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomByFactor.current(1.5)}
          className="flex h-8 w-8 items-center justify-center rounded bg-black/60 text-lg leading-none text-white hover:bg-black/80"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomByFactor.current(0.667)}
          className="flex h-8 w-8 items-center justify-center rounded bg-black/60 text-lg leading-none text-white hover:bg-black/80"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          onClick={() => goHome.current()}
          className="flex h-8 w-8 items-center justify-center rounded bg-black/60 text-sm leading-none text-white hover:bg-black/80"
        >
          ⌂
        </button>
      </div>

      {isLoading && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded bg-black/70 px-3 py-2 text-sm text-white">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <span>Loading slide...</span>
        </div>
      )}
    </div>
  )
})
