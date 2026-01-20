import { memo, useRef, useEffect, useCallback, useMemo, useState } from 'react'
import type { CellMask } from '../../types/overlay'
import { triangulatePolygon, calculateScreenSize } from '../../utils/triangulate'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface WebGLCellOverlayProps {
  cells: CellMask[]
  viewerBounds: DOMRect
  viewport: Viewport
  slideWidth: number
  slideHeight: number
  opacity?: number
}

// Cell type colors as RGB (0-1 range) - PathView compatible mapping
// Alpha is applied separately via the opacity prop
const CELL_TYPE_COLORS: Record<string, [number, number, number]> = {
  // Cancer/Tumor cells - Red tones
  'cancer cell': [0.9, 0.2, 0.2],
  tumor: [0.85, 0.15, 0.15],
  'mitotic figures': [1.0, 0.0, 0.0],

  // Immune cells - Various colors
  lymphocytes: [0.2, 0.8, 0.2], // Green
  lymphocyte: [0.2, 0.8, 0.2],
  macrophages: [0.6, 0.4, 0.8], // Purple
  neutrophils: [0.2, 0.6, 1.0], // Light blue
  eosinophils: [1.0, 0.5, 0.0], // Orange
  'plasma cells': [0.8, 0.2, 0.8], // Magenta

  // Stromal cells - Blue/Cyan tones
  fibroblasts: [0.3, 0.7, 0.9], // Cyan
  stroma: [0.4, 0.6, 0.9],
  'muscle cell': [0.6, 0.3, 0.1], // Brown
  'endothelial cells': [0.9, 0.7, 0.2], // Yellow

  // Other
  'apoptotic body': [0.5, 0.5, 0.5], // Gray
  necrosis: [0.3, 0.3, 0.3], // Dark gray

  // Default fallback
  default: [0.6, 0.6, 0.6],
}

// LOD thresholds (screen pixel size)
const LOD_SKIP = 2
const LOD_POINT = 4
const LOD_BOX = 10
const LOD_SIMPLIFIED = 30

// Point size in pixels
const POINT_SIZE = 2

// Vertex shader - transforms slide coordinates to clip space
const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  uniform mat3 u_transform;

  void main() {
    vec3 pos = u_transform * vec3(a_position, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    gl_PointSize = ${POINT_SIZE.toFixed(1)};
  }
`

// Fragment shader
const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  uniform vec4 u_color;

  void main() {
    gl_FragColor = u_color;
  }
`

function getCellColor(cellType: string, opacity: number): [number, number, number, number] {
  const rgb = CELL_TYPE_COLORS[cellType.toLowerCase()] ?? CELL_TYPE_COLORS.default
  return [rgb[0], rgb[1], rgb[2], opacity]
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program linking error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

interface CellBuffer {
  cellType: string
  // Full triangulated geometry
  fullBuffer: WebGLBuffer | null
  fullVertexCount: number
  // Simplified geometry (fewer triangles)
  simplifiedBuffer: WebGLBuffer | null
  simplifiedVertexCount: number
  // Box geometry (bounding boxes)
  boxBuffer: WebGLBuffer | null
  boxVertexCount: number
  // Point geometry (centroids)
  pointBuffer: WebGLBuffer | null
  pointVertexCount: number
  // Original cells for LOD calculation
  cells: CellMask[]
}

export const WebGLCellOverlay = memo(function WebGLCellOverlay({
  cells,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
  opacity = 0.6,
}: WebGLCellOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const locationsRef = useRef<{
    position: number
    transform: WebGLUniformLocation | null
    color: WebGLUniformLocation | null
  } | null>(null)
  const cellBuffersRef = useRef<Map<string, CellBuffer>>(new Map())
  const rafIdRef = useRef<number | null>(null)
  // Track buffer version to trigger re-renders when buffers change
  const [bufferVersion, setBufferVersion] = useState(0)
  // Track WebGL ready state to trigger buffer creation after init
  const [glReady, setGlReady] = useState(0)

  // Initialize WebGL context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    })
    if (!gl) {
      console.error('WebGL2 not supported')
      return
    }

    glRef.current = gl

    // Create shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)

    if (!vertexShader || !fragmentShader) return

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) return

    programRef.current = program

    // Get attribute and uniform locations
    locationsRef.current = {
      position: gl.getAttribLocation(program, 'a_position'),
      transform: gl.getUniformLocation(program, 'u_transform'),
      color: gl.getUniformLocation(program, 'u_color'),
    }

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Signal that WebGL is ready - this triggers buffer creation
    setGlReady((v) => v + 1)

    // Cleanup - only delete WebGL resources, don't clear the buffer map
    // (buffer map will be cleared by buffer creation effect)
    return () => {
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      glRef.current = null
      programRef.current = null
      locationsRef.current = null
    }
  }, [])

  // Update buffers when cells change or WebGL context is ready
  useEffect(() => {
    const gl = glRef.current
    if (!gl || !programRef.current) {
      console.log('[WebGLCellOverlay] Buffer creation skipped - no GL context')
      return
    }

    // Delete old buffers (if any exist and context is valid)
    for (const buffer of cellBuffersRef.current.values()) {
      if (buffer.fullBuffer) gl.deleteBuffer(buffer.fullBuffer)
      if (buffer.simplifiedBuffer) gl.deleteBuffer(buffer.simplifiedBuffer)
      if (buffer.boxBuffer) gl.deleteBuffer(buffer.boxBuffer)
      if (buffer.pointBuffer) gl.deleteBuffer(buffer.pointBuffer)
    }
    cellBuffersRef.current.clear()

    console.log('[WebGLCellOverlay] Creating buffers for', cells.length, 'cells')

    // Group cells by type
    const cellsByType = new Map<string, CellMask[]>()
    for (const cell of cells) {
      const type = cell.cell_type.toLowerCase()
      if (!cellsByType.has(type)) {
        cellsByType.set(type, [])
      }
      cellsByType.get(type)!.push(cell)
    }

    // Debug: log first cell's coordinates
    if (cells.length > 0) {
      const firstCell = cells[0]
      console.log('[WebGLCellOverlay] First cell:', {
        cell_id: firstCell.cell_id,
        cell_type: firstCell.cell_type,
        coordCount: firstCell.coordinates.length,
        firstCoord: firstCell.coordinates[0],
        centroid: firstCell.centroid,
      })
    }

    // Create buffers for each cell type
    for (const [cellType, typeCells] of cellsByType) {
      const fullVertices: number[] = []
      const simplifiedVertices: number[] = []
      const boxVertices: number[] = []
      const pointVertices: number[] = []

      for (const cell of typeCells) {
        // Full triangulated geometry
        const triangulated = triangulatePolygon(cell.coordinates)
        for (let i = 0; i < triangulated.length; i++) {
          fullVertices.push(triangulated[i])
        }

        // Simplified geometry - use every Nth point (skip some vertices)
        if (cell.coordinates.length > 6) {
          const step = Math.ceil(cell.coordinates.length / 6)
          const simplifiedCoords = cell.coordinates.filter((_, i) => i % step === 0)
          if (simplifiedCoords.length >= 3) {
            const simplifiedTriangulated = triangulatePolygon(simplifiedCoords)
            for (let i = 0; i < simplifiedTriangulated.length; i++) {
              simplifiedVertices.push(simplifiedTriangulated[i])
            }
          }
        } else {
          // Cell already has few vertices, use full geometry
          for (let i = 0; i < triangulated.length; i++) {
            simplifiedVertices.push(triangulated[i])
          }
        }

        // Box geometry - compute bounding box
        let minX = cell.coordinates[0]?.x ?? 0
        let maxX = minX
        let minY = cell.coordinates[0]?.y ?? 0
        let maxY = minY
        for (const pt of cell.coordinates) {
          if (pt.x < minX) minX = pt.x
          if (pt.x > maxX) maxX = pt.x
          if (pt.y < minY) minY = pt.y
          if (pt.y > maxY) maxY = pt.y
        }
        // Two triangles for the box
        boxVertices.push(minX, minY, maxX, minY, maxX, maxY, minX, minY, maxX, maxY, minX, maxY)

        // Point geometry - centroid
        pointVertices.push(cell.centroid.x, cell.centroid.y)
      }

      // Create GPU buffers
      const fullBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, fullBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fullVertices), gl.STATIC_DRAW)

      const simplifiedBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, simplifiedBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(simplifiedVertices), gl.STATIC_DRAW)

      const boxBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boxVertices), gl.STATIC_DRAW)

      const pointBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointVertices), gl.STATIC_DRAW)

      console.log(`[WebGLCellOverlay] Buffer for ${cellType}:`, {
        cellCount: typeCells.length,
        fullVertexCount: fullVertices.length / 2,
        simplifiedVertexCount: simplifiedVertices.length / 2,
        boxVertexCount: boxVertices.length / 2,
        pointVertexCount: pointVertices.length / 2,
      })

      cellBuffersRef.current.set(cellType, {
        cellType,
        fullBuffer,
        fullVertexCount: fullVertices.length / 2,
        simplifiedBuffer,
        simplifiedVertexCount: simplifiedVertices.length / 2,
        boxBuffer,
        boxVertexCount: boxVertices.length / 2,
        pointBuffer,
        pointVertexCount: pointVertices.length / 2,
        cells: typeCells,
      })
    }

    // Trigger re-render when buffers are updated

    setBufferVersion((v) => v + 1)
  }, [cells, glReady])

  // Calculate viewport transform matrix
  const transformMatrix = useMemo(() => {
    if (viewport.zoom <= 0 || slideWidth <= 0 || slideHeight <= 0) {
      console.log('[WebGLCellOverlay] Transform matrix null - invalid params:', {
        zoom: viewport.zoom,
        slideWidth,
        slideHeight,
      })
      return null
    }

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    const viewportLeft = viewport.centerX - viewportWidth / 2
    const viewportTop = viewport.centerY - viewportHeight / 2

    // Transform: slide coords -> normalized (0-1) -> viewport relative (0-1) -> clip space (-1 to 1)
    // Combined into a 3x3 matrix (column-major for WebGL)
    // NOTE: OpenSeadragon uses width-normalized coordinates (image width = 1),
    // so both X and Y slide coords are normalized by slideWidth
    const scaleX = 2 / viewportWidth / slideWidth
    const scaleY = -2 / viewportHeight / slideWidth // Flip Y; use slideWidth for OSD normalization
    const translateX = (-2 * viewportLeft) / viewportWidth - 1
    const translateY = (2 * viewportTop) / viewportHeight + 1

    console.log('[WebGLCellOverlay] Transform:', {
      viewport: { centerX: viewport.centerX, centerY: viewport.centerY, zoom: viewport.zoom },
      viewportBounds: {
        left: viewportLeft,
        top: viewportTop,
        width: viewportWidth,
        height: viewportHeight,
      },
      slideSize: { width: slideWidth, height: slideHeight },
      scale: { x: scaleX, y: scaleY },
      translate: { x: translateX, y: translateY },
    })

    return new Float32Array([scaleX, 0, 0, 0, scaleY, 0, translateX, translateY, 1])
  }, [viewport, viewerBounds.width, viewerBounds.height, slideWidth, slideHeight])

  // Calculate current LOD level based on average cell size
  const lodLevel = useMemo(() => {
    if (cells.length === 0) return 'FULL'

    const viewportWidth = 1 / viewport.zoom

    // Sample a few cells to determine LOD
    const sampleSize = Math.min(10, cells.length)
    let totalSize = 0
    for (let i = 0; i < sampleSize; i++) {
      const cell = cells[Math.floor((i * cells.length) / sampleSize)]
      totalSize += calculateScreenSize(
        cell.coordinates,
        slideWidth,
        viewportWidth,
        viewerBounds.width
      )
    }
    const avgSize = totalSize / sampleSize

    if (avgSize < LOD_SKIP) return 'SKIP'
    if (avgSize < LOD_POINT) return 'POINT'
    if (avgSize < LOD_BOX) return 'BOX'
    if (avgSize < LOD_SIMPLIFIED) return 'SIMPLIFIED'
    return 'FULL'
  }, [cells, viewport.zoom, slideWidth, viewerBounds.width])

  // Render function
  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const locations = locationsRef.current

    if (!gl || !program || !locations || !transformMatrix) {
      console.log('[WebGLCellOverlay] Render skipped - missing:', {
        gl: !!gl,
        program: !!program,
        locations: !!locations,
        transformMatrix: !!transformMatrix,
      })
      return
    }

    // Clear canvas
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const bufferCount = cellBuffersRef.current.size
    console.log('[WebGLCellOverlay] Render:', {
      canvasSize: `${gl.canvas.width}x${gl.canvas.height}`,
      bufferCount,
      lodLevel,
    })

    // Skip rendering if LOD is SKIP
    if (lodLevel === 'SKIP') return

    gl.useProgram(program)

    // Set transform uniform
    gl.uniformMatrix3fv(locations.transform, false, transformMatrix)

    // Enable vertex attribute
    gl.enableVertexAttribArray(locations.position)

    // Render each cell type batch
    for (const buffer of cellBuffersRef.current.values()) {
      // Set color for this cell type (with current opacity)
      const color = getCellColor(buffer.cellType, opacity)
      gl.uniform4fv(locations.color, color)

      // Choose buffer based on LOD level
      let vertexBuffer: WebGLBuffer | null
      let vertexCount: number
      let drawMode: number

      switch (lodLevel) {
        case 'POINT':
          vertexBuffer = buffer.pointBuffer
          vertexCount = buffer.pointVertexCount
          drawMode = gl.POINTS
          break
        case 'BOX':
          vertexBuffer = buffer.boxBuffer
          vertexCount = buffer.boxVertexCount
          drawMode = gl.TRIANGLES
          break
        case 'SIMPLIFIED':
          vertexBuffer = buffer.simplifiedBuffer
          vertexCount = buffer.simplifiedVertexCount
          drawMode = gl.TRIANGLES
          break
        default: // 'FULL'
          vertexBuffer = buffer.fullBuffer
          vertexCount = buffer.fullVertexCount
          drawMode = gl.TRIANGLES
      }

      if (!vertexBuffer || vertexCount === 0) continue

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(drawMode, 0, vertexCount)
    }
    // bufferVersion is intentionally included to trigger re-render when buffers change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformMatrix, lodLevel, bufferVersion, opacity])

  // Render on each animation frame when viewport changes
  useEffect(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    rafIdRef.current = requestAnimationFrame(() => {
      render()
      rafIdRef.current = null
    })

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [render])

  // Update canvas size when bounds change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = viewerBounds.width * dpr
    canvas.height = viewerBounds.height * dpr
    canvas.style.width = `${viewerBounds.width}px`
    canvas.style.height = `${viewerBounds.height}px`

    const gl = glRef.current
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
  }, [viewerBounds.width, viewerBounds.height])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{
        width: viewerBounds.width,
        height: viewerBounds.height,
        zIndex: 10,
      }}
    />
  )
})
