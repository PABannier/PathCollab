/**
 * Coordinate conversion between OpenSeadragon-normalized viewport coordinates
 * (used by PathCollab's collaboration protocol, cursor layer, and minimap) and
 * fovea's slide-pixel camera. All conversion is confined here + in FoveaViewer so
 * the rest of the app keeps speaking OSD-normalized coordinates unchanged.
 *
 * OSD-normalized: centerX/centerY in [0,1] normalized by slide WIDTH (so a square
 * region of the slide has centerY range [0, height/width]); zoom = 1 means the
 * slide width exactly fills the viewport width.
 *
 * Fovea camera: centerX/centerY in slide pixels; zoom = CSS-px per slide-px (the
 * visible slide width in pixels is canvasCssWidth / zoom). Note dpr does NOT enter
 * these formulas because fovea's zoom is defined in CSS pixels.
 *
 *   centerX_px = centerX_n * W            centerX_n = centerX_px / W
 *   zoom_fovea = canvasCssWidth * zoom_osd / W
 *   zoom_osd   = zoom_fovea * W / canvasCssWidth
 */

export interface OsdViewport {
  centerX: number
  centerY: number
  zoom: number
}

export interface FoveaCamera {
  centerX: number
  centerY: number
  zoom: number
}

export function foveaToOsd(
  cam: FoveaCamera,
  slideWidth: number,
  canvasCssWidth: number
): OsdViewport {
  const w = slideWidth > 0 ? slideWidth : 1
  const cw = canvasCssWidth > 0 ? canvasCssWidth : 1
  return {
    centerX: cam.centerX / w,
    centerY: cam.centerY / w,
    zoom: (cam.zoom * w) / cw,
  }
}

export function osdToFovea(
  vp: OsdViewport,
  slideWidth: number,
  canvasCssWidth: number
): FoveaCamera {
  const w = slideWidth > 0 ? slideWidth : 1
  const cw = canvasCssWidth > 0 ? canvasCssWidth : 1
  return {
    centerX: vp.centerX * w,
    centerY: vp.centerY * w,
    zoom: (vp.zoom * cw) / w,
  }
}

/**
 * Cell-type → RGB color (0..1). Ported verbatim from the previous WebGL cell
 * overlay so colors are byte-for-byte identical. Pushed into the fovea engine via
 * setCellClassColors; fovea owns *how* to render, PathCollab owns *which* colors.
 */
export const CELL_TYPE_COLORS: Record<string, [number, number, number]> = {
  'cancer cell': [0.9, 0.2, 0.2],
  tumor: [0.85, 0.15, 0.15],
  'mitotic figures': [1.0, 0.0, 0.0],
  lymphocytes: [0.2, 0.8, 0.2],
  lymphocyte: [0.2, 0.8, 0.2],
  macrophages: [0.6, 0.4, 0.8],
  neutrophils: [0.2, 0.6, 1.0],
  eosinophils: [1.0, 0.5, 0.0],
  'plasma cells': [0.8, 0.2, 0.8],
  fibroblasts: [0.3, 0.7, 0.9],
  stroma: [0.4, 0.6, 0.9],
  'muscle cell': [0.6, 0.3, 0.1],
  'endothelial cells': [0.9, 0.7, 0.2],
  'apoptotic body': [0.5, 0.5, 0.5],
  necrosis: [0.3, 0.3, 0.3],
  default: [0.6, 0.6, 0.6],
}

export function cellColorFor(name: string): [number, number, number] {
  return CELL_TYPE_COLORS[name.toLowerCase()] ?? CELL_TYPE_COLORS.default
}

export interface CellClass {
  id: number
  name: string
}

/**
 * Build the flat RGBA color LUT (4 floats per class id, indexed by id) to push via
 * setCellClassColors. Alpha is 1; global opacity is handled by setLayerOpacity.
 */
export function buildCellClassColors(classes: CellClass[]): Float32Array {
  const maxId = classes.reduce((m, c) => Math.max(m, c.id), -1)
  const data = new Float32Array((maxId + 1) * 4)
  for (const cls of classes) {
    const [r, g, b] = cellColorFor(cls.name)
    const o = cls.id * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 1
  }
  return data
}

/**
 * Build the per-class visibility flag array (indexed by class id) from the set of
 * currently visible cell-type names.
 */
export function buildCellClassVisibility(
  classes: CellClass[],
  visibleTypes: Set<string>
): Uint8Array {
  const maxId = classes.reduce((m, c) => Math.max(m, c.id), -1)
  const flags = new Uint8Array(maxId + 1)
  for (const cls of classes) {
    flags[cls.id] = visibleTypes.has(cls.name) ? 1 : 0
  }
  return flags
}

/** Base URL for a slide's fovea rendering data, served by the PathCollab forwarder. */
export function foveaSlideUrl(slideId: string): string {
  return `/api/fovea/${encodeURIComponent(slideId)}/slide`
}

export function foveaCellsUrl(slideId: string): string {
  return `/api/fovea/${encodeURIComponent(slideId)}/cells`
}

export function foveaHeatmapUrl(slideId: string): string {
  return `/api/fovea/${encodeURIComponent(slideId)}/heatmap`
}
