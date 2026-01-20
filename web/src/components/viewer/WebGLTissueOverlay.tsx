import { memo, useRef, useEffect, useCallback, useMemo, useState } from 'react'
import type { TissueOverlayMetadata, TissueClassInfo } from '../../types/overlay'
import type { CachedTile } from '../../hooks/useTissueOverlay'
import type { TissueTileIndex, ViewportBounds } from '../../utils/TissueTileIndex'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface WebGLTissueOverlayProps {
  metadata: TissueOverlayMetadata
  tiles: Map<string, CachedTile>
  tileIndex: TissueTileIndex
  currentLevel: number
  viewerBounds: DOMRect
  viewport: Viewport
  slideWidth: number
  opacity?: number
  visibleClasses: Set<number>
}

// Default tissue color palette indexed by class ID (matching pathview's kDefaultTissuePalette)
// Colors are [R, G, B] in 0-1 range (alpha applied via opacity uniform)
const DEFAULT_TISSUE_PALETTE: Array<[number, number, number]> = [
  [1.0, 0.388, 0.278], // 0: Tomato red - tumor
  [0.565, 0.933, 0.565], // 1: Light green - stroma
  [0.529, 0.808, 0.922], // 2: Sky blue - necrosis
  [1.0, 0.855, 0.725], // 3: Peach - background/adipose
  [0.867, 0.627, 0.867], // 4: Plum - lymphocyte aggregate
  [0.941, 0.902, 0.549], // 5: Khaki - mucus
  [0.737, 0.561, 0.561], // 6: Rosy brown - blood
  [0.686, 0.933, 0.933], // 7: Pale turquoise - epithelium
  [1.0, 0.714, 0.757], // 8: Light pink - muscle
  [0.827, 0.827, 0.827], // 9: Light gray - cartilage
  [0.596, 0.984, 0.596], // 10: Pale green - nerve
  [1.0, 0.627, 0.478], // 11: Light salmon - other
]

// Name-based fallback colors for classes that don't match by ID
const TISSUE_COLORS_BY_NAME: Record<string, [number, number, number]> = {
  tumor: [1.0, 0.388, 0.278],
  stroma: [0.565, 0.933, 0.565],
  necrosis: [0.529, 0.808, 0.922],
  background: [0, 0, 0], // Transparent background
  adipose: [1.0, 0.855, 0.725],
  fat: [1.0, 0.855, 0.725],
  lymphocyte_aggregate: [0.867, 0.627, 0.867],
  lymphocytes: [0.867, 0.627, 0.867],
  mucus: [0.941, 0.902, 0.549],
  blood: [0.737, 0.561, 0.561],
  epithelium: [0.686, 0.933, 0.933],
  muscle: [1.0, 0.714, 0.757],
  cartilage: [0.827, 0.827, 0.827],
  nerve: [0.596, 0.984, 0.596],
  other: [1.0, 0.627, 0.478],
}

// Vertex shader - transforms slide coordinates to clip space (GLSL ES 3.0)
const VERTEX_SHADER_SOURCE = `#version 300 es
  in vec2 a_position;
  in vec2 a_texcoord;
  uniform mat3 u_transform;
  out vec2 v_texcoord;

  void main() {
    vec3 pos = u_transform * vec3(a_position, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`

// Fragment shader - O(1) LUT lookups using texelFetch (GLSL ES 3.0)
const FRAGMENT_SHADER_SOURCE = `#version 300 es
  precision mediump float;
  uniform sampler2D u_texture;         // Tile class indices
  uniform sampler2D u_colorLUT;        // 16x1 RGBA texture for colors
  uniform sampler2D u_visibilityLUT;   // 16x1 R8 texture for visibility
  uniform float u_opacity;
  in vec2 v_texcoord;
  out vec4 fragColor;

  void main() {
    // Sample the class index from the red channel
    float classValue = texture(u_texture, v_texcoord).r;
    int classIndex = int(classValue * 255.0 + 0.5);

    // O(1) visibility lookup using texelFetch
    float visible = texelFetch(u_visibilityLUT, ivec2(classIndex, 0), 0).r;
    if (visible < 0.5) {
      discard;
    }

    // O(1) color lookup using texelFetch
    vec4 color = texelFetch(u_colorLUT, ivec2(classIndex, 0), 0);

    fragColor = vec4(color.rgb, color.a * u_opacity);
  }
`

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

/** Build colormap array from class info */
function buildColormap(classes: TissueClassInfo[]): Float32Array {
  const colormap = new Float32Array(16 * 4) // 16 classes * 4 components (RGBA)

  // Initialize with default palette colors
  for (let i = 0; i < 16; i++) {
    const offset = i * 4
    if (i < DEFAULT_TISSUE_PALETTE.length) {
      const color = DEFAULT_TISSUE_PALETTE[i]
      colormap[offset] = color[0]
      colormap[offset + 1] = color[1]
      colormap[offset + 2] = color[2]
      colormap[offset + 3] = 1.0 // Full alpha (opacity controlled by uniform)
    } else {
      // Fallback for classes beyond palette
      const fallback = DEFAULT_TISSUE_PALETTE[DEFAULT_TISSUE_PALETTE.length - 1]
      colormap[offset] = fallback[0]
      colormap[offset + 1] = fallback[1]
      colormap[offset + 2] = fallback[2]
      colormap[offset + 3] = 1.0
    }
  }

  // Override with name-based colors if class names are recognized
  for (const cls of classes) {
    if (cls.id < 0 || cls.id >= 16) continue

    const normalizedName = cls.name.toLowerCase().replace(/\s+/g, '_')
    const nameColor = TISSUE_COLORS_BY_NAME[normalizedName]

    if (nameColor) {
      const offset = cls.id * 4
      colormap[offset] = nameColor[0]
      colormap[offset + 1] = nameColor[1]
      colormap[offset + 2] = nameColor[2]
      // Special case: background should be transparent
      colormap[offset + 3] = normalizedName === 'background' ? 0.0 : 1.0
    }
  }

  return colormap
}

/** Build visibility LUT data (16 bytes, one per class) */
function buildVisibilityLUT(visibleClasses: Set<number>): Uint8Array {
  const data = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    data[i] = visibleClasses.has(i) ? 255 : 0
  }
  return data
}

interface TileTexture {
  texture: WebGLTexture
  tile: CachedTile
}

export const WebGLTissueOverlay = memo(function WebGLTissueOverlay({
  metadata,
  tiles,
  tileIndex,
  currentLevel,
  viewerBounds,
  viewport,
  slideWidth,
  opacity = 0.7,
  visibleClasses,
}: WebGLTissueOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const locationsRef = useRef<{
    position: number
    texcoord: number
    transform: WebGLUniformLocation | null
    texture: WebGLUniformLocation | null
    colorLUT: WebGLUniformLocation | null
    visibilityLUT: WebGLUniformLocation | null
    opacity: WebGLUniformLocation | null
  } | null>(null)
  const texturesRef = useRef<Map<string, TileTexture>>(new Map())
  const colorLUTRef = useRef<WebGLTexture | null>(null)
  const visibilityLUTRef = useRef<WebGLTexture | null>(null)
  const positionBufferRef = useRef<WebGLBuffer | null>(null)
  const texcoordBufferRef = useRef<WebGLBuffer | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [glReady, setGlReady] = useState(0)

  // Initialize WebGL context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
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
      texcoord: gl.getAttribLocation(program, 'a_texcoord'),
      transform: gl.getUniformLocation(program, 'u_transform'),
      texture: gl.getUniformLocation(program, 'u_texture'),
      colorLUT: gl.getUniformLocation(program, 'u_colorLUT'),
      visibilityLUT: gl.getUniformLocation(program, 'u_visibilityLUT'),
      opacity: gl.getUniformLocation(program, 'u_opacity'),
    }

    // Create position buffer (will be updated per-tile)
    positionBufferRef.current = gl.createBuffer()
    texcoordBufferRef.current = gl.createBuffer()

    // Set up texcoord buffer (DYNAMIC_DRAW for fallback rendering with custom texcoords)
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBufferRef.current)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.DYNAMIC_DRAW
    )

    // Create color LUT texture (16x1 RGBA8)
    const colorLUT = gl.createTexture()
    if (colorLUT) {
      gl.bindTexture(gl.TEXTURE_2D, colorLUT)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      colorLUTRef.current = colorLUT
    }

    // Create visibility LUT texture (16x1 R8)
    const visibilityLUT = gl.createTexture()
    if (visibilityLUT) {
      gl.bindTexture(gl.TEXTURE_2D, visibilityLUT)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 16, 1, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      visibilityLUTRef.current = visibilityLUT
    }

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Trigger re-render after WebGL init to ensure textures are created
    setGlReady((v) => v + 1)

    // Capture ref values for cleanup
    const texturesToClean = texturesRef.current
    const colorLUTToClean = colorLUTRef.current
    const visibilityLUTToClean = visibilityLUTRef.current

    return () => {
      // Clean up textures
      for (const { texture } of texturesToClean.values()) {
        gl.deleteTexture(texture)
      }
      texturesToClean.clear()

      if (colorLUTToClean) gl.deleteTexture(colorLUTToClean)
      if (visibilityLUTToClean) gl.deleteTexture(visibilityLUTToClean)

      gl.deleteBuffer(positionBufferRef.current)
      gl.deleteBuffer(texcoordBufferRef.current)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      glRef.current = null
      programRef.current = null
      locationsRef.current = null
      colorLUTRef.current = null
      visibilityLUTRef.current = null
    }
  }, [])

  // Update textures when tiles change (textures are cached permanently, never deleted until unmount)
  useEffect(() => {
    const gl = glRef.current
    if (!gl || !programRef.current) return

    // Create textures for new tiles (never delete existing textures - they stay cached)
    for (const [key, tile] of tiles) {
      if (texturesRef.current.has(key)) continue

      const texture = gl.createTexture()
      if (!texture) continue

      gl.bindTexture(gl.TEXTURE_2D, texture)

      // Upload tile data as R8 texture (single channel, class indices)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        tile.width,
        tile.height,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        tile.data
      )

      // Set texture parameters
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      texturesRef.current.set(key, { texture, tile })
    }

    // NOTE: We intentionally do NOT delete textures when tiles are removed from the Map.
    // Tissue tiles are cheap to render and we want to keep them cached for instant re-display
    // when panning back or re-enabling the overlay. Textures are only cleaned up on unmount.
  }, [tiles, glReady])

  // Calculate viewport transform matrix
  const transformMatrix = useMemo(() => {
    if (viewport.zoom <= 0 || slideWidth <= 0) {
      return null
    }

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    const viewportLeft = viewport.centerX - viewportWidth / 2
    const viewportTop = viewport.centerY - viewportHeight / 2

    // Transform: slide coords -> normalized (0-1) -> viewport relative (0-1) -> clip space (-1 to 1)
    const scaleX = 2 / viewportWidth / slideWidth
    const scaleY = -2 / viewportHeight / slideWidth // Flip Y; use slideWidth for OSD normalization
    const translateX = (-2 * viewportLeft) / viewportWidth - 1
    const translateY = (2 * viewportTop) / viewportHeight + 1

    return new Float32Array([scaleX, 0, 0, 0, scaleY, 0, translateX, translateY, 1])
  }, [viewport, viewerBounds.width, viewerBounds.height, slideWidth])

  // Build colormap from metadata (Float32Array for CPU-side reference)
  const colormap = useMemo(() => buildColormap(metadata.classes), [metadata.classes])

  // Update color LUT texture when colormap changes
  useEffect(() => {
    const gl = glRef.current
    const colorLUT = colorLUTRef.current
    if (!gl || !colorLUT) return

    // Convert Float32Array colormap to Uint8Array for texture upload
    const colorData = new Uint8Array(16 * 4)
    for (let i = 0; i < 16; i++) {
      const offset = i * 4
      colorData[offset] = Math.round(colormap[offset] * 255)
      colorData[offset + 1] = Math.round(colormap[offset + 1] * 255)
      colorData[offset + 2] = Math.round(colormap[offset + 2] * 255)
      colorData[offset + 3] = Math.round(colormap[offset + 3] * 255)
    }

    gl.bindTexture(gl.TEXTURE_2D, colorLUT)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, colorData)
  }, [colormap, glReady])

  // Build visibility LUT data
  const visibilityData = useMemo(() => buildVisibilityLUT(visibleClasses), [visibleClasses])

  // Update visibility LUT texture when visibility changes
  useEffect(() => {
    const gl = glRef.current
    const visibilityLUT = visibilityLUTRef.current
    if (!gl || !visibilityLUT) return

    gl.bindTexture(gl.TEXTURE_2D, visibilityLUT)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 1, gl.RED, gl.UNSIGNED_BYTE, visibilityData)
  }, [visibilityData, glReady])

  // Calculate viewport bounds in slide coordinates for spatial queries
  const viewportBounds = useMemo((): ViewportBounds | null => {
    if (viewport.zoom <= 0 || slideWidth <= 0) return null

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom

    // Convert from normalized (0-1) to slide pixel coordinates
    const left = (viewport.centerX - viewportWidth / 2) * slideWidth
    const top = (viewport.centerY - viewportHeight / 2) * slideWidth // Use slideWidth for OSD normalization
    const right = (viewport.centerX + viewportWidth / 2) * slideWidth
    const bottom = (viewport.centerY + viewportHeight / 2) * slideWidth

    return { left, top, right, bottom }
  }, [
    viewport.centerX,
    viewport.centerY,
    viewport.zoom,
    viewerBounds.width,
    viewerBounds.height,
    slideWidth,
  ])

  // Standard texcoords for full tile rendering (unit square)
  const UNIT_TEXCOORDS = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])

  // Render function
  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const locations = locationsRef.current

    if (!gl || !program || !locations || !transformMatrix || !viewportBounds) {
      return
    }

    // Clear canvas
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (texturesRef.current.size === 0) {
      return
    }

    gl.useProgram(program)

    // Set uniforms
    gl.uniformMatrix3fv(locations.transform, false, transformMatrix)
    gl.uniform1f(locations.opacity, opacity)

    // Bind color LUT to texture unit 1
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, colorLUTRef.current)
    gl.uniform1i(locations.colorLUT, 1)

    // Bind visibility LUT to texture unit 2
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, visibilityLUTRef.current)
    gl.uniform1i(locations.visibilityLUT, 2)

    // Enable vertex attributes
    gl.enableVertexAttribArray(locations.position)
    gl.enableVertexAttribArray(locations.texcoord)

    // Query visible tiles at current level using spatial index (O(k) instead of O(n))
    const visibleTiles = tileIndex.queryViewport(currentLevel, viewportBounds)

    // Track tiles that need fallback (visible but texture not loaded yet)
    const tilesNeedingFallback: Array<{
      tile: CachedTile
      bounds: { left: number; top: number; right: number; bottom: number }
    }> = []

    // First pass: render current-level tiles that are loaded
    for (const indexedTile of visibleTiles) {
      const tile = indexedTile.tile
      const key = `${tile.level}-${tile.x}-${tile.y}`
      const tileTexture = texturesRef.current.get(key)

      if (!tileTexture) {
        // Tile not loaded yet, queue for fallback rendering
        tilesNeedingFallback.push({ tile, bounds: tile.bounds })
        continue
      }

      // Use pre-computed bounds from tile cache
      const { left: tileLeft, top: tileTop, right: tileRight, bottom: tileBottom } = tile.bounds

      // Create position buffer for this tile (two triangles forming a quad)
      const positions = new Float32Array([
        tileLeft,
        tileTop,
        tileRight,
        tileTop,
        tileLeft,
        tileBottom,
        tileLeft,
        tileBottom,
        tileRight,
        tileTop,
        tileRight,
        tileBottom,
      ])

      // Set standard texcoords (full tile)
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, UNIT_TEXCOORDS, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.texcoord, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0)

      // Bind texture
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tileTexture.texture)
      gl.uniform1i(locations.texture, 0)

      // Draw tile
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    // Second pass: render fallback tiles for missing current-level tiles
    for (const { tile, bounds } of tilesNeedingFallback) {
      const fallback = tileIndex.findFallback(tile.level, tile.x, tile.y, bounds)
      if (!fallback) continue

      const fallbackKey = `${fallback.tile.level}-${fallback.tile.x}-${fallback.tile.y}`
      const fallbackTexture = texturesRef.current.get(fallbackKey)
      if (!fallbackTexture) continue

      // Position: where the target tile should appear
      const { left: tileLeft, top: tileTop, right: tileRight, bottom: tileBottom } = bounds
      const positions = new Float32Array([
        tileLeft,
        tileTop,
        tileRight,
        tileTop,
        tileLeft,
        tileBottom,
        tileLeft,
        tileBottom,
        tileRight,
        tileTop,
        tileRight,
        tileBottom,
      ])

      // Texcoords: sample only the relevant portion of the fallback tile
      const { u0, v0, u1, v1 } = fallback.texCoords
      const texcoords = new Float32Array([u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1])

      gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.texcoord, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0)

      // Bind fallback texture
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fallbackTexture.texture)
      gl.uniform1i(locations.texture, 0)

      // Draw fallback tile
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tiles is intentionally included to trigger re-render when new tiles load
  }, [
    transformMatrix,
    viewportBounds,
    colormap,
    visibilityData,
    opacity,
    currentLevel,
    tileIndex,
    tiles, // Re-render when tiles change (triggers after texture effect creates textures)
  ])

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
        zIndex: 9, // Below cell overlay (zIndex: 10)
      }}
    />
  )
})
