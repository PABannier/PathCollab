import { memo, useRef, useEffect, useCallback, useMemo, useState } from 'react'
import type { HeatmapLayerInfo } from '../../types/overlay'
import type { CachedHeatmapTile } from '../../hooks/useHeatmapOverlay'
import type { TissueTileIndex, ViewportBounds } from '../../utils/TissueTileIndex'

interface Viewport {
  centerX: number
  centerY: number
  zoom: number
}

interface WebGLHeatmapOverlayProps {
  heatmap: HeatmapLayerInfo
  tiles: Map<string, CachedHeatmapTile>
  tileIndex: TissueTileIndex
  currentLevel: number
  viewerBounds: DOMRect
  viewport: Viewport
  slideWidth: number
  opacity?: number
}

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

const FRAGMENT_SHADER_SOURCE = `#version 300 es
  precision highp float;
  uniform sampler2D u_texture;
  uniform sampler2D u_viridisLUT;
  uniform float u_minValue;
  uniform float u_maxValue;
  uniform float u_opacity;
  uniform float u_tileOpacity;
  in vec2 v_texcoord;
  out vec4 fragColor;

  void main() {
    float value = texture(u_texture, v_texcoord).r;
    if (value != value) {
      discard;
    }

    float denom = max(u_maxValue - u_minValue, 0.000001);
    float normalized = clamp((value - u_minValue) / denom, 0.0, 1.0);
    int lutIndex = int(normalized * 255.0 + 0.5);
    vec4 color = texelFetch(u_viridisLUT, ivec2(lutIndex, 0), 0);
    fragColor = vec4(color.rgb, color.a * u_opacity * u_tileOpacity);
  }
`

const TILE_FADE_IN_DURATION = 200
const UNIT_TEXCOORDS = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
const positionBuffer = new Float32Array(12)
const texcoordBuffer = new Float32Array(12)

interface TileTexture {
  texture: WebGLTexture
  tile: CachedHeatmapTile
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
    console.error('Heatmap shader compilation error:', gl.getShaderInfoLog(shader))
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
    console.error('Heatmap program linking error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

function interpolateColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function buildViridisLUT(): Uint8Array {
  const stops: Array<[number, number, number]> = [
    [68, 1, 84],
    [72, 35, 116],
    [64, 67, 135],
    [52, 94, 141],
    [41, 120, 142],
    [32, 144, 140],
    [34, 167, 132],
    [68, 190, 112],
    [121, 209, 81],
    [189, 223, 38],
    [253, 231, 37],
  ]
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * (stops.length - 1)
    const idx = Math.min(stops.length - 2, Math.floor(p))
    const t = p - idx
    const color = interpolateColor(stops[idx], stops[idx + 1], t)
    lut[i * 4] = color[0]
    lut[i * 4 + 1] = color[1]
    lut[i * 4 + 2] = color[2]
    lut[i * 4 + 3] = 255
  }
  return lut
}

function textureKey(heatmapName: string, level: number, x: number, y: number): string {
  return `${heatmapName}-${level}-${x}-${y}`
}

export const WebGLHeatmapOverlay = memo(function WebGLHeatmapOverlay({
  heatmap,
  tiles,
  tileIndex,
  currentLevel,
  viewerBounds,
  viewport,
  slideWidth,
  opacity = 0.75,
}: WebGLHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const locationsRef = useRef<{
    position: number
    texcoord: number
    transform: WebGLUniformLocation | null
    texture: WebGLUniformLocation | null
    viridisLUT: WebGLUniformLocation | null
    minValue: WebGLUniformLocation | null
    maxValue: WebGLUniformLocation | null
    opacity: WebGLUniformLocation | null
    tileOpacity: WebGLUniformLocation | null
  } | null>(null)
  const texturesRef = useRef<Map<string, TileTexture>>(new Map())
  const viridisLUTRef = useRef<WebGLTexture | null>(null)
  const positionBufferRef = useRef<WebGLBuffer | null>(null)
  const texcoordBufferRef = useRef<WebGLBuffer | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [glReady, setGlReady] = useState(0)

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

    const floatTexture = gl.getExtension('EXT_color_buffer_float')
    if (!floatTexture) {
      console.warn('EXT_color_buffer_float unavailable; heatmap float texture support may vary')
    }

    glRef.current = gl

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
    if (!vertexShader || !fragmentShader) return

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) return
    programRef.current = program

    locationsRef.current = {
      position: gl.getAttribLocation(program, 'a_position'),
      texcoord: gl.getAttribLocation(program, 'a_texcoord'),
      transform: gl.getUniformLocation(program, 'u_transform'),
      texture: gl.getUniformLocation(program, 'u_texture'),
      viridisLUT: gl.getUniformLocation(program, 'u_viridisLUT'),
      minValue: gl.getUniformLocation(program, 'u_minValue'),
      maxValue: gl.getUniformLocation(program, 'u_maxValue'),
      opacity: gl.getUniformLocation(program, 'u_opacity'),
      tileOpacity: gl.getUniformLocation(program, 'u_tileOpacity'),
    }

    positionBufferRef.current = gl.createBuffer()
    texcoordBufferRef.current = gl.createBuffer()

    const viridisLUT = gl.createTexture()
    if (viridisLUT) {
      gl.bindTexture(gl.TEXTURE_2D, viridisLUT)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        256,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        buildViridisLUT()
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      viridisLUTRef.current = viridisLUT
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    setGlReady((v) => v + 1)

    const texturesToClean = texturesRef.current
    const viridisToClean = viridisLUTRef.current

    return () => {
      for (const { texture } of texturesToClean.values()) {
        gl.deleteTexture(texture)
      }
      texturesToClean.clear()
      if (viridisToClean) gl.deleteTexture(viridisToClean)
      gl.deleteBuffer(positionBufferRef.current)
      gl.deleteBuffer(texcoordBufferRef.current)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      glRef.current = null
      programRef.current = null
      locationsRef.current = null
      viridisLUTRef.current = null
    }
  }, [])

  useEffect(() => {
    const gl = glRef.current
    if (!gl || !programRef.current) return

    for (const tile of tiles.values()) {
      const key = textureKey(heatmap.name, tile.level, tile.x, tile.y)
      if (texturesRef.current.has(key)) continue

      const texture = gl.createTexture()
      if (!texture) continue

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        tile.width,
        tile.height,
        0,
        gl.RED,
        gl.FLOAT,
        tile.data
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      texturesRef.current.set(key, { texture, tile })
    }
  }, [tiles, glReady, heatmap.name])

  useEffect(() => {
    const gl = glRef.current
    if (!gl) return

    for (const { texture } of texturesRef.current.values()) {
      gl.deleteTexture(texture)
    }
    texturesRef.current.clear()
  }, [heatmap.name])

  const viewportBounds = useMemo((): ViewportBounds | null => {
    if (viewport.zoom <= 0 || slideWidth <= 0) return null

    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = viewerBounds.height / viewerBounds.width / viewport.zoom
    return {
      left: (viewport.centerX - viewportWidth / 2) * slideWidth,
      top: (viewport.centerY - viewportHeight / 2) * slideWidth,
      right: (viewport.centerX + viewportWidth / 2) * slideWidth,
      bottom: (viewport.centerY + viewportHeight / 2) * slideWidth,
    }
  }, [
    viewport.centerX,
    viewport.centerY,
    viewport.zoom,
    viewerBounds.width,
    viewerBounds.height,
    slideWidth,
  ])

  const render = useCallback(() => {
    const gl = glRef.current
    const canvas = canvasRef.current
    const program = programRef.current
    const locations = locationsRef.current
    if (!gl || !canvas || !program || !locations || !viewportBounds) return

    const canvasWidth = canvas.clientWidth || 1
    const canvasHeight = canvas.clientHeight || 1
    const viewportWidth = 1 / viewport.zoom
    const viewportHeight = canvasHeight / canvasWidth / viewport.zoom
    const viewportLeft = viewport.centerX - viewportWidth / 2
    const viewportTop = viewport.centerY - viewportHeight / 2

    const transformMatrix = new Float32Array([
      2 / viewportWidth / slideWidth,
      0,
      0,
      0,
      -2 / viewportHeight / slideWidth,
      0,
      (-2 * viewportLeft) / viewportWidth - 1,
      (2 * viewportTop) / viewportHeight + 1,
      1,
    ])

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (texturesRef.current.size === 0) return

    gl.useProgram(program)
    gl.uniformMatrix3fv(locations.transform, false, transformMatrix)
    gl.uniform1f(locations.minValue, heatmap.min_value)
    gl.uniform1f(locations.maxValue, heatmap.max_value)
    gl.uniform1f(locations.opacity, opacity)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, viridisLUTRef.current)
    gl.uniform1i(locations.viridisLUT, 1)
    gl.uniform1i(locations.texture, 0)

    gl.enableVertexAttribArray(locations.position)
    gl.enableVertexAttribArray(locations.texcoord)

    const visibleTiles = tileIndex.queryViewport(currentLevel, viewportBounds)
    const tilesNeedingFallback: Array<{
      tile: CachedHeatmapTile
      bounds: { left: number; top: number; right: number; bottom: number }
    }> = []

    const now = performance.now()
    let needsAnimationFrame = false

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBufferRef.current)
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_TEXCOORDS, gl.DYNAMIC_DRAW)
    gl.vertexAttribPointer(locations.texcoord, 2, gl.FLOAT, false, 0, 0)

    for (const indexedTile of visibleTiles) {
      const tile = indexedTile.tile as CachedHeatmapTile
      const key = textureKey(heatmap.name, tile.level, tile.x, tile.y)
      const tileTexture = texturesRef.current.get(key)

      if (!tileTexture) {
        tilesNeedingFallback.push({ tile, bounds: tile.bounds })
        continue
      }

      const fadeProgress = Math.min(1, (now - tile.loadTime) / TILE_FADE_IN_DURATION)
      const tileOpacity = fadeProgress < 1 ? 1 - Math.pow(1 - fadeProgress, 3) : 1
      if (fadeProgress < 1) needsAnimationFrame = true
      gl.uniform1f(locations.tileOpacity, tileOpacity)

      const { left, top, right, bottom } = tile.bounds
      positionBuffer[0] = left
      positionBuffer[1] = top
      positionBuffer[2] = right
      positionBuffer[3] = top
      positionBuffer[4] = left
      positionBuffer[5] = bottom
      positionBuffer[6] = left
      positionBuffer[7] = bottom
      positionBuffer[8] = right
      positionBuffer[9] = top
      positionBuffer[10] = right
      positionBuffer[11] = bottom

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, positionBuffer, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tileTexture.texture)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    gl.uniform1f(locations.tileOpacity, 1.0)

    for (const { tile, bounds } of tilesNeedingFallback) {
      const fallback = tileIndex.findFallback(tile.level, tile.x, tile.y, bounds)
      if (!fallback) continue

      const fallbackTile = fallback.tile as CachedHeatmapTile
      const fallbackKey = textureKey(
        heatmap.name,
        fallbackTile.level,
        fallbackTile.x,
        fallbackTile.y
      )
      const fallbackTexture = texturesRef.current.get(fallbackKey)
      if (!fallbackTexture) continue

      const { left, top, right, bottom } = bounds
      positionBuffer[0] = left
      positionBuffer[1] = top
      positionBuffer[2] = right
      positionBuffer[3] = top
      positionBuffer[4] = left
      positionBuffer[5] = bottom
      positionBuffer[6] = left
      positionBuffer[7] = bottom
      positionBuffer[8] = right
      positionBuffer[9] = top
      positionBuffer[10] = right
      positionBuffer[11] = bottom

      const { u0, v0, u1, v1 } = fallback.texCoords
      texcoordBuffer[0] = u0
      texcoordBuffer[1] = v0
      texcoordBuffer[2] = u1
      texcoordBuffer[3] = v0
      texcoordBuffer[4] = u0
      texcoordBuffer[5] = v1
      texcoordBuffer[6] = u0
      texcoordBuffer[7] = v1
      texcoordBuffer[8] = u1
      texcoordBuffer[9] = v0
      texcoordBuffer[10] = u1
      texcoordBuffer[11] = v1

      gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, texcoordBuffer, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.texcoord, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBufferRef.current)
      gl.bufferData(gl.ARRAY_BUFFER, positionBuffer, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fallbackTexture.texture)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    if (needsAnimationFrame && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        render()
      })
    }
  }, [viewport, slideWidth, viewportBounds, opacity, currentLevel, tileIndex, heatmap, tiles])

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
        zIndex: 8,
      }}
    />
  )
})
