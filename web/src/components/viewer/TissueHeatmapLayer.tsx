import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

interface TissueHeatmapLayerProps {
  overlayId: string | null
  viewerBounds: DOMRect | null
  viewport: { centerX: number; centerY: number; zoom: number }
  slideWidth: number
  slideHeight: number
  tileSize: number
  levels: number
  tissueClasses: TissueClass[]
  visibleClasses: number[]
  opacity: number
  enabled: boolean
}

interface TissueClass {
  id: number
  name: string
  color: string
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex
  const r = parseInt(normalized.slice(0, 2), 16) / 255
  const g = parseInt(normalized.slice(2, 4), 16) / 255
  const b = parseInt(normalized.slice(4, 6), 16) / 255
  return [r, g, b]
}

// Vertex shader for tile rendering
const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

uniform vec2 u_viewportCenter;
uniform float u_viewportZoom;
uniform vec2 u_canvasSize;
uniform vec4 u_tileRect;  // x, y, width, height in normalized coords

out vec2 v_texCoord;

void main() {
  // Calculate tile position in normalized slide coords
  vec2 tilePos = u_tileRect.xy + a_position * u_tileRect.zw;

  // Transform from slide coords [0,1] to viewport-relative coords
  float viewportWidth = 1.0 / u_viewportZoom;
  float viewportHeight = (u_canvasSize.y / u_canvasSize.x) / u_viewportZoom;

  // Position relative to viewport center
  vec2 relPos = (tilePos - u_viewportCenter) / vec2(viewportWidth, viewportHeight);

  // Convert to clip space [-1, 1]
  vec2 clipPos = relPos * 2.0;

  gl_Position = vec4(clipPos.x, -clipPos.y, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`

// Fragment shader - applies opacity and class visibility to pre-colorized tiles from server
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_opacity;
uniform vec3 u_classColors[8];
uniform float u_classVisible[8];

void main() {
  vec4 texColor = texture(u_texture, v_texCoord);
  // The texture contains RGBA from server with pre-applied class colors
  // Apply class visibility by matching colors to palette entries.
  float visible = 1.0;
  float epsilon = 0.01;
  for (int i = 0; i < 8; i++) {
    if (distance(texColor.rgb, u_classColors[i]) < epsilon) {
      visible = u_classVisible[i];
      break;
    }
  }
  fragColor = vec4(texColor.rgb, texColor.a * u_opacity * visible);
}
`

interface TileCache {
  texture: WebGLTexture
  loading: boolean
  lastUsed: number // Timestamp for LRU eviction
}

// Maximum number of tiles to cache (prevents unbounded GPU memory growth)
const MAX_TILE_CACHE_SIZE = 64
const CLASS_COUNT = 8

export function TissueHeatmapLayer({
  overlayId,
  viewerBounds,
  viewport,
  slideWidth,
  slideHeight,
  tileSize,
  levels,
  tissueClasses,
  visibleClasses,
  opacity,
  enabled,
}: TissueHeatmapLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null)
  const posBufferRef = useRef<WebGLBuffer | null>(null)
  const texCoordBufferRef = useRef<WebGLBuffer | null>(null)
  const tileCacheRef = useRef<Map<string, TileCache>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const visibleClassSet = useMemo(() => new Set(visibleClasses), [visibleClasses])
  const classColors = useMemo(() => {
    const colors: number[] = []
    for (let i = 0; i < CLASS_COUNT; i++) {
      const entry = tissueClasses.find((cls) => cls.id === i)
      const [r, g, b] = entry ? hexToRgb(entry.color) : [0, 0, 0]
      colors.push(r, g, b)
    }
    return new Float32Array(colors)
  }, [tissueClasses])
  const classVisibility = useMemo(() => {
    const visibility = new Float32Array(CLASS_COUNT)
    for (let i = 0; i < CLASS_COUNT; i++) {
      visibility[i] = visibleClassSet.has(i) ? 1 : 0
    }
    return visibility
  }, [visibleClassSet])

  // Initialize WebGL2 context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Capture ref value at effect setup time for cleanup
    const tileCache = tileCacheRef.current

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
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

    // Create VAO for tile quad
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)

    // Position buffer (unit quad)
    const positions = new Float32Array([
      0,
      0, // bottom-left
      1,
      0, // bottom-right
      0,
      1, // top-left
      1,
      1, // top-right
    ])
    const posBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    posBufferRef.current = posBuffer

    const posLoc = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Texture coordinate buffer
    const texCoords = new Float32Array([
      0,
      1, // bottom-left
      1,
      1, // bottom-right
      0,
      0, // top-left
      1,
      0, // top-right
    ])
    const texCoordBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
    texCoordBufferRef.current = texCoordBuffer

    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord')
    gl.enableVertexAttribArray(texCoordLoc)
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)
    vaoRef.current = vao

    // Enable blending
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Cleanup
    return () => {
      // Delete cached textures (using tileCache captured at setup time)
      for (const tile of tileCache.values()) {
        if (tile.texture) {
          gl.deleteTexture(tile.texture)
        }
      }
      tileCache.clear()

      if (posBufferRef.current) {
        gl.deleteBuffer(posBufferRef.current)
      }
      if (texCoordBufferRef.current) {
        gl.deleteBuffer(texCoordBufferRef.current)
      }
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      gl.deleteShader(vertShader)
      gl.deleteShader(fragShader)
    }
  }, [])

  // Load a tile texture
  const loadTile = useCallback(
    async (level: number, x: number, y: number) => {
      const gl = glRef.current
      if (!gl || !overlayId) return null

      const tileKey = `${level}/${x}/${y}`
      const cache = tileCacheRef.current

      // Check cache
      if (cache.has(tileKey)) {
        const cached = cache.get(tileKey)!
        if (!cached.loading) {
          // Update last used time
          cached.lastUsed = Date.now()
          return cached.texture
        }
        return null
      }

      // Evict old tiles if cache is too large (LRU eviction)
      if (cache.size >= MAX_TILE_CACHE_SIZE) {
        let oldestKey: string | null = null
        let oldestTime = Infinity
        for (const [key, tile] of cache.entries()) {
          if (!tile.loading && tile.lastUsed < oldestTime) {
            oldestTime = tile.lastUsed
            oldestKey = key
          }
        }
        if (oldestKey) {
          const oldTile = cache.get(oldestKey)
          if (oldTile?.texture) {
            gl.deleteTexture(oldTile.texture)
          }
          cache.delete(oldestKey)
        }
      }

      // Mark as loading
      cache.set(tileKey, {
        texture: null as unknown as WebGLTexture,
        loading: true,
        lastUsed: Date.now(),
      })

      try {
        const response = await fetch(`/api/overlay/${overlayId}/raster/${level}/${x}/${y}`)
        if (!response.ok) {
          cache.delete(tileKey)
          return null
        }

        // Get tile dimensions from headers
        const width = parseInt(response.headers.get('X-Tile-Width') || '256')
        const height = parseInt(response.headers.get('X-Tile-Height') || '256')

        const data = await response.arrayBuffer()
        const pixels = new Uint8Array(data)

        // Create texture
        const texture = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          width,
          height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels
        )
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindTexture(gl.TEXTURE_2D, null)

        cache.set(tileKey, { texture, loading: false, lastUsed: Date.now() })
        return texture
      } catch {
        cache.delete(tileKey)
        return null
      }
    },
    [overlayId]
  )

  // Calculate visible tiles for current viewport
  const visibleTiles = useMemo(() => {
    if (!viewerBounds || !overlayId) return []
    if (slideWidth <= 0 || slideHeight <= 0 || tileSize <= 0) return []

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    // Viewport bounds in normalized coords [0,1]
    const minX = viewport.centerX - viewportWidth / 2
    const maxX = viewport.centerX + viewportWidth / 2
    const minY = viewport.centerY - viewportHeight / 2
    const maxY = viewport.centerY + viewportHeight / 2

    // Determine tile level based on viewport coverage
    const maxTilesPerAxis = 5
    const maxLevel = Math.max(0, levels - 1)
    const tilesAcross = (viewportWidth * slideWidth) / (tileSize * maxTilesPerAxis)
    const desiredLevel =
      Number.isFinite(tilesAcross) && tilesAcross > 0 ? Math.ceil(Math.log2(tilesAcross)) : 0
    const level = Math.max(0, Math.min(maxLevel, desiredLevel))
    const scale = Math.pow(2, level)

    // NOTE: Both tileWidth and tileHeight are normalized by slideWidth to match OSD's coordinate system
    const tileWidth = (tileSize * scale) / slideWidth
    const tileHeight = (tileSize * scale) / slideWidth
    const tilesPerDimX = Math.max(1, Math.ceil(slideWidth / (tileSize * scale)))
    const tilesPerDimY = Math.max(1, Math.ceil(slideHeight / (tileSize * scale)))

    // Calculate tile range
    let startX = Math.max(0, Math.floor(minX / tileWidth))
    let endX = Math.min(tilesPerDimX - 1, Math.ceil(maxX / tileWidth))
    let startY = Math.max(0, Math.floor(minY / tileHeight))
    let endY = Math.min(tilesPerDimY - 1, Math.ceil(maxY / tileHeight))

    // Limit tiles around the viewport center
    // NOTE: Both centerX and centerY use slideWidth for conversion to match OSD coords
    const centerTileX = Math.floor((viewport.centerX * slideWidth) / (tileSize * scale))
    const centerTileY = Math.floor((viewport.centerY * slideWidth) / (tileSize * scale))

    if (endX - startX + 1 > maxTilesPerAxis) {
      startX = Math.max(0, centerTileX - Math.floor(maxTilesPerAxis / 2))
      endX = Math.min(tilesPerDimX - 1, startX + maxTilesPerAxis - 1)
      startX = Math.max(0, endX - maxTilesPerAxis + 1)
    }

    if (endY - startY + 1 > maxTilesPerAxis) {
      startY = Math.max(0, centerTileY - Math.floor(maxTilesPerAxis / 2))
      endY = Math.min(tilesPerDimY - 1, startY + maxTilesPerAxis - 1)
      startY = Math.max(0, endY - maxTilesPerAxis + 1)
    }

    const tiles: Array<{
      level: number
      x: number
      y: number
      rect: [number, number, number, number]
    }> = []

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        tiles.push({
          level,
          x: tx,
          y: ty,
          rect: [tx * tileWidth, ty * tileHeight, tileWidth, tileHeight],
        })
      }
    }

    return tiles
  }, [viewerBounds, viewport, overlayId, slideWidth, slideHeight, tileSize, levels])

  // Load tiles and render
  useEffect(() => {
    if (!enabled || !overlayId || !viewerBounds) return

    const gl = glRef.current
    const program = programRef.current
    const vao = vaoRef.current
    const canvas = canvasRef.current

    if (!gl || !program || !vao || !canvas) return

    // Track if effect is still active for async operations
    let cancelled = false

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

    gl.useProgram(program)

    // Set common uniforms
    const centerLoc = gl.getUniformLocation(program, 'u_viewportCenter')
    const zoomLoc = gl.getUniformLocation(program, 'u_viewportZoom')
    const sizeLoc = gl.getUniformLocation(program, 'u_canvasSize')
    const opacityLoc = gl.getUniformLocation(program, 'u_opacity')
    const textureLoc = gl.getUniformLocation(program, 'u_texture')
    const tileRectLoc = gl.getUniformLocation(program, 'u_tileRect')
    const classColorsLoc = gl.getUniformLocation(program, 'u_classColors[0]')
    const classVisibleLoc = gl.getUniformLocation(program, 'u_classVisible[0]')

    gl.uniform2f(centerLoc, viewport.centerX, viewport.centerY)
    gl.uniform1f(zoomLoc, viewport.zoom)
    gl.uniform2f(sizeLoc, viewerBounds.width, viewerBounds.height)
    gl.uniform1f(opacityLoc, opacity)
    gl.uniform1i(textureLoc, 0)
    if (classColorsLoc) {
      gl.uniform3fv(classColorsLoc, classColors)
    }
    if (classVisibleLoc) {
      gl.uniform1fv(classVisibleLoc, classVisibility)
    }

    // Load and render tiles asynchronously
    const renderTiles = async () => {
      for (const tile of visibleTiles) {
        if (cancelled) return
        const texture = await loadTile(tile.level, tile.x, tile.y)
        if (cancelled) return
        if (texture) {
          gl.bindVertexArray(vao)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.uniform4f(tileRectLoc, tile.rect[0], tile.rect[1], tile.rect[2], tile.rect[3])
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          gl.bindVertexArray(null)
        }
      }
    }

    renderTiles()

    return () => {
      cancelled = true
    }
  }, [
    viewport,
    viewerBounds,
    visibleTiles,
    opacity,
    enabled,
    overlayId,
    loadTile,
    classColors,
    classVisibility,
  ])

  if (!enabled || !viewerBounds || !overlayId) return null

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
