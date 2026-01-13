import { useEffect, useRef, useState } from 'react'

interface CellPolygon {
  x: number  // Slide coordinates
  y: number
  classId: number
  confidence: number
  vertices: number[]  // Flat array of relative vertex positions
}

interface OverlayCanvasProps {
  cells: CellPolygon[]
  viewerBounds: DOMRect | null
  viewport: { centerX: number; centerY: number; zoom: number }
  slideWidth: number
  slideHeight: number
  cellClasses: CellClass[]
  visibleClasses: number[]
  opacity: number
  enabled: boolean
}

interface CellClass {
  id: number
  name: string
  color: string
}

// Default cell class colors (15 classes)
const DEFAULT_CELL_COLORS: string[] = [
  '#DC2626', // 0: Red
  '#EA580C', // 1: Orange
  '#CA8A04', // 2: Yellow
  '#16A34A', // 3: Green
  '#0D9488', // 4: Teal
  '#0891B2', // 5: Cyan
  '#2563EB', // 6: Blue
  '#7C3AED', // 7: Violet
  '#C026D3', // 8: Fuchsia
  '#DB2777', // 9: Pink
  '#84CC16', // 10: Lime
  '#06B6D4', // 11: Light cyan
  '#8B5CF6', // 12: Purple
  '#F43F5E', // 13: Rose
  '#64748B', // 14: Slate
]

// Vertex shader for polygon rendering
const VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex attributes
in vec2 a_position;      // Vertex position in normalized coordinates [0,1]
in vec4 a_color;         // Cell color (RGBA)

// Uniforms for viewport transformation
uniform vec2 u_viewportCenter;
uniform float u_viewportZoom;
uniform vec2 u_canvasSize;

out vec4 v_color;

void main() {
  // Transform from slide coords [0,1] to viewport-relative coords
  float viewportWidth = 1.0 / u_viewportZoom;
  float viewportHeight = (u_canvasSize.y / u_canvasSize.x) / u_viewportZoom;

  // Position relative to viewport center
  vec2 relPos = (a_position - u_viewportCenter) / vec2(viewportWidth, viewportHeight);

  // Convert to clip space [-1, 1]
  vec2 clipPos = relPos * 2.0;

  gl_Position = vec4(clipPos.x, -clipPos.y, 0.0, 1.0);
  v_color = a_color;
}
`

// Fragment shader
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

uniform float u_opacity;

void main() {
  fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`

// Parse hex color to RGBA
function hexToRgba(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b, 0.7]  // 70% alpha for polygons
}

export function OverlayCanvas({
  cells,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
  cellClasses,
  visibleClasses,
  opacity,
  enabled,
}: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null)
  const posBufferRef = useRef<WebGLBuffer | null>(null)
  const colorBufferRef = useRef<WebGLBuffer | null>(null)
  const vertexCountRef = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)

  // Initialize WebGL2 context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    })

    if (!gl) {
      setError('WebGL2 not supported')
      return
    }

    glRef.current = gl

    // Create and compile shaders
    const vertShader = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vertShader, VERTEX_SHADER)
    gl.compileShader(vertShader)
    if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vertShader))
      setError('Shader compilation failed')
      return
    }

    const fragShader = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fragShader, FRAGMENT_SHADER)
    gl.compileShader(fragShader)
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fragShader))
      setError('Shader compilation failed')
      return
    }

    // Link program
    const program = gl.createProgram()!
    gl.attachShader(program, vertShader)
    gl.attachShader(program, fragShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      setError('Shader link failed')
      return
    }

    programRef.current = program

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Cleanup on unmount
    return () => {
      if (vaoRef.current) {
        gl.deleteVertexArray(vaoRef.current)
      }
      if (posBufferRef.current) {
        gl.deleteBuffer(posBufferRef.current)
      }
      if (colorBufferRef.current) {
        gl.deleteBuffer(colorBufferRef.current)
      }
      gl.deleteProgram(program)
      gl.deleteShader(vertShader)
      gl.deleteShader(fragShader)
    }
  }, [])

  // Build vertex data when cells change
  useEffect(() => {
    const gl = glRef.current
    const program = programRef.current
    if (!gl || !program || !cells.length) return

    // Build vertex data for all visible cells
    const vertices: number[] = []
    const colors: number[] = []

    // Create color lookup from cellClasses or use defaults
    const colorLookup: [number, number, number, number][] = []
    for (let i = 0; i < 15; i++) {
      const cellClass = cellClasses.find(c => c.id === i)
      const hex = cellClass?.color || DEFAULT_CELL_COLORS[i]
      colorLookup[i] = hexToRgba(hex)
    }

    for (const cell of cells) {
      // Skip if class not visible
      if (!visibleClasses.includes(cell.classId)) continue

      const color = colorLookup[cell.classId] || colorLookup[0]

      // Convert cell centroid to normalized coordinates
      const cx = cell.x / slideWidth
      const cy = cell.y / slideHeight

      if (cell.vertices.length >= 6) {
        // Triangulate polygon using fan from centroid
        for (let i = 0; i < cell.vertices.length - 2; i += 2) {
          const v0x = cell.vertices[i] / slideWidth
          const v0y = cell.vertices[i + 1] / slideHeight
          const v1x = cell.vertices[i + 2] / slideWidth
          const v1y = cell.vertices[i + 3] / slideHeight

          // Triangle: centroid, v0, v1
          vertices.push(cx, cy)
          colors.push(...color)

          vertices.push(cx + v0x, cy + v0y)
          colors.push(...color)

          vertices.push(cx + v1x, cy + v1y)
          colors.push(...color)
        }

        // Close the polygon (last vertex to first)
        if (cell.vertices.length >= 4) {
          const lastIdx = cell.vertices.length - 2
          const v0x = cell.vertices[lastIdx] / slideWidth
          const v0y = cell.vertices[lastIdx + 1] / slideHeight
          const v1x = cell.vertices[0] / slideWidth
          const v1y = cell.vertices[1] / slideHeight

          vertices.push(cx, cy)
          colors.push(...color)

          vertices.push(cx + v0x, cy + v0y)
          colors.push(...color)

          vertices.push(cx + v1x, cy + v1y)
          colors.push(...color)
        }
      } else {
        // No vertices - draw a small circle approximation (hexagon)
        const radius = 10 / slideWidth
        for (let i = 0; i < 6; i++) {
          const a0 = (i / 6) * Math.PI * 2
          const a1 = ((i + 1) / 6) * Math.PI * 2

          vertices.push(cx, cy)
          colors.push(...color)

          vertices.push(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius * (slideWidth / slideHeight))
          colors.push(...color)

          vertices.push(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius * (slideWidth / slideHeight))
          colors.push(...color)
        }
      }
    }

    if (vertices.length === 0) {
      vertexCountRef.current = 0
      return
    }

    // Delete old VAO and buffers
    if (vaoRef.current) {
      gl.deleteVertexArray(vaoRef.current)
    }
    if (posBufferRef.current) {
      gl.deleteBuffer(posBufferRef.current)
    }
    if (colorBufferRef.current) {
      gl.deleteBuffer(colorBufferRef.current)
    }

    // Create VAO
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    vaoRef.current = vao

    // Position buffer
    const posBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
    posBufferRef.current = posBuffer

    const posLoc = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Color buffer
    const colorBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW)
    colorBufferRef.current = colorBuffer

    const colorLoc = gl.getAttribLocation(program, 'a_color')
    gl.enableVertexAttribArray(colorLoc)
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)

    vertexCountRef.current = vertices.length / 2

  }, [cells, cellClasses, visibleClasses, slideWidth, slideHeight])

  // Render on viewport change
  useEffect(() => {
    const gl = glRef.current
    const program = programRef.current
    const vao = vaoRef.current
    const canvas = canvasRef.current

    if (!gl || !program || !vao || !canvas || !viewerBounds || !enabled) return
    if (vertexCountRef.current === 0) return

    // Resize canvas if needed
    const width = Math.floor(viewerBounds.width * window.devicePixelRatio)
    const height = Math.floor(viewerBounds.height * window.devicePixelRatio)

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }

    // Clear
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Use program
    gl.useProgram(program)

    // Set uniforms
    const centerLoc = gl.getUniformLocation(program, 'u_viewportCenter')
    const zoomLoc = gl.getUniformLocation(program, 'u_viewportZoom')
    const sizeLoc = gl.getUniformLocation(program, 'u_canvasSize')
    const opacityLoc = gl.getUniformLocation(program, 'u_opacity')

    gl.uniform2f(centerLoc, viewport.centerX, viewport.centerY)
    gl.uniform1f(zoomLoc, viewport.zoom)
    gl.uniform2f(sizeLoc, viewerBounds.width, viewerBounds.height)
    gl.uniform1f(opacityLoc, opacity)

    // Draw
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, vertexCountRef.current)
    gl.bindVertexArray(null)

  }, [viewport, viewerBounds, opacity, enabled])

  if (!enabled || !viewerBounds) return null

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">
        {error}
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{
        width: viewerBounds.width,
        height: viewerBounds.height,
      }}
    />
  )
}
