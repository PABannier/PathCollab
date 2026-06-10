import { describe, expect, it } from 'vitest'
import {
  buildCellClassColors,
  buildCellClassVisibility,
  foveaToOsd,
  osdToFovea,
} from './foveaViewport'

describe('foveaViewport coordinate conversion', () => {
  const W = 100000 // slide width (px)
  const Cw = 1200 // canvas CSS width (px)

  it('osdToFovea maps a known OSD viewport to slide-pixel camera', () => {
    // zoom_osd = 1 means the slide width fills the viewport width.
    const cam = osdToFovea({ centerX: 0.5, centerY: 0.5, zoom: 1 }, W, Cw)
    expect(cam.centerX).toBeCloseTo(50000)
    expect(cam.centerY).toBeCloseTo(50000)
    // CSS-px per slide-px: 1200 css px shows 100000 slide px → 0.012
    expect(cam.zoom).toBeCloseTo(Cw / W)
  })

  it('foveaToOsd is the inverse of osdToFovea (round-trip)', () => {
    const vp = { centerX: 0.37, centerY: 0.22, zoom: 4.5 }
    const back = foveaToOsd(osdToFovea(vp, W, Cw), W, Cw)
    expect(back.centerX).toBeCloseTo(vp.centerX)
    expect(back.centerY).toBeCloseTo(vp.centerY)
    expect(back.zoom).toBeCloseTo(vp.zoom)
  })

  it('normalizes both axes by width (aspect-ratio preserving)', () => {
    // centerY is normalized by width, not height — the load-bearing convention.
    const vp = foveaToOsd({ centerX: 0, centerY: W, zoom: 1 }, W, Cw)
    expect(vp.centerY).toBeCloseTo(1)
  })
})

describe('cell class LUTs', () => {
  const classes = [
    { id: 0, name: 'tumor' },
    { id: 2, name: 'lymphocytes' },
  ]

  it('builds an RGBA color LUT indexed by class id', () => {
    const colors = buildCellClassColors(classes)
    expect(colors.length).toBe(3 * 4) // maxId 2 -> 3 entries
    // tumor = [0.85, 0.15, 0.15] (float32 tolerance)
    expect(colors[0]).toBeCloseTo(0.85)
    expect(colors[1]).toBeCloseTo(0.15)
    expect(colors[2]).toBeCloseTo(0.15)
    expect(colors[3]).toBe(1)
    // id 1 is unspecified -> zeros
    for (let i = 4; i < 8; i += 1) expect(colors[i]).toBe(0)
  })

  it('builds visibility flags from the visible-type set', () => {
    const flags = buildCellClassVisibility(classes, new Set(['tumor']))
    expect(flags[0]).toBe(1) // tumor visible
    expect(flags[2]).toBe(0) // lymphocytes hidden
  })
})
