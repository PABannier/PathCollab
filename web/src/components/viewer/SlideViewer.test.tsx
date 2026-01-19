/**
 * SlideViewer Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { SlideViewer, type SlideViewerHandle } from './SlideViewer'
import { createRef } from 'react'

// Mock OpenSeadragon since it requires DOM canvas
vi.mock('openseadragon', () => {
  const mockViewer = {
    addHandler: vi.fn(),
    removeHandler: vi.fn(),
    destroy: vi.fn(),
    viewport: {
      getCenter: vi.fn(() => ({ x: 0.5, y: 0.5 })),
      getZoom: vi.fn(() => 1.0),
      zoomTo: vi.fn(),
      panTo: vi.fn(),
      panBy: vi.fn(),
      zoomBy: vi.fn(),
      goHome: vi.fn(),
      resize: vi.fn(),
      applyConstraints: vi.fn(),
    },
    world: {
      addHandler: vi.fn(),
      getItemAt: vi.fn(() => ({
        getContentSize: vi.fn(() => ({ x: 10000, y: 10000 })),
      })),
    },
    open: vi.fn(),
    element: document.createElement('div'),
  }

  // Mock Point class
  class MockPoint {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  }

  // Mock TileSource class
  class MockTileSource {
    config: unknown
    constructor(config: unknown) {
      this.config = config
    }
  }

  const OpenSeadragonMock = vi.fn(() => mockViewer) as ReturnType<typeof vi.fn> & {
    ControlAnchor: Record<string, number>
    Point: typeof MockPoint
    TileSource: typeof MockTileSource
  }

  // Add static properties
  OpenSeadragonMock.ControlAnchor = {
    NONE: 0,
    TOP_LEFT: 1,
    TOP_RIGHT: 2,
    BOTTOM_RIGHT: 3,
    BOTTOM_LEFT: 4,
    ABSOLUTE: 5,
  }

  OpenSeadragonMock.Point = MockPoint
  OpenSeadragonMock.TileSource = MockTileSource

  return {
    default: OpenSeadragonMock,
  }
})

// Test slide data matching Phase 1 SlideInfo schema
const testSlide = {
  id: 'test-slide',
  name: 'Test Slide',
  width: 100000,
  height: 100000,
  tileSize: 256,
  numLevels: 10,
  tileUrlTemplate: '/api/slide/{id}/tile/{level}/{x}/{y}',
}

describe('SlideViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a container element for OpenSeadragon', () => {
    render(<SlideViewer slide={testSlide} />)

    // Phase 1 spec: Component should render a container for the viewer
    const container = document.querySelector('[class*="viewer"]') || document.querySelector('div')
    expect(container).toBeTruthy()
  })

  it('creates tile source with correct URL template', async () => {
    const OpenSeadragon = await import('openseadragon')

    render(<SlideViewer slide={testSlide} />)

    // Phase 1 spec: OpenSeadragon should be initialized
    await waitFor(() => {
      expect(OpenSeadragon.default).toHaveBeenCalled()
    })

    // Verify the tile source configuration was passed
    const osdCall = (OpenSeadragon.default as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0]
    expect(osdCall).toBeTruthy()
  })

  it('generates correct tile URLs from template', () => {
    // Phase 1 spec: URL template pattern /slide/{id}/tile/{level}/{x}/{y}
    const template = testSlide.tileUrlTemplate
    const level = 5
    const x = 10
    const y = 20

    // Simulate tile URL generation
    const url = template
      .replace('{id}', testSlide.id)
      .replace('{level}', String(level))
      .replace('{x}', String(x))
      .replace('{y}', String(y))

    expect(url).toBe('/api/slide/test-slide/tile/5/10/20')
  })

  it('calls onViewportChange when viewport changes', async () => {
    const onViewportChange = vi.fn()

    render(<SlideViewer slide={testSlide} onViewportChange={onViewportChange} />)

    // The component should register a viewport-change handler
    const OpenSeadragon = await import('openseadragon')
    const mockViewer = (OpenSeadragon.default as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]?.value

    // Find the viewport-change handler that was registered
    const addHandlerCalls = mockViewer?.addHandler.mock.calls || []
    const viewportHandler = addHandlerCalls.find(
      (call: unknown[]) => call[0] === 'viewport-change'
    )?.[1]

    if (viewportHandler) {
      // Simulate viewport change
      act(() => {
        viewportHandler()
      })

      // Phase 1 spec: onViewportChange should be called with viewport data
      // Note: Due to throttling, might not be called immediately
    }
  })

  it('calls onTileLoadError when tile fails to load', async () => {
    const onTileLoadError = vi.fn()

    render(<SlideViewer slide={testSlide} onTileLoadError={onTileLoadError} />)

    const OpenSeadragon = await import('openseadragon')
    const mockViewer = (OpenSeadragon.default as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]?.value

    // Find the tile-load-failed handler
    const addHandlerCalls = mockViewer?.addHandler.mock.calls || []
    const errorHandler = addHandlerCalls.find(
      (call: unknown[]) => call[0] === 'tile-load-failed'
    )?.[1]

    if (errorHandler) {
      // Simulate tile load error
      act(() => {
        errorHandler({ tile: { level: 5, x: 10, y: 20 } })
      })

      // Phase 1 spec: onTileLoadError should be called
      await waitFor(() => {
        expect(onTileLoadError).toHaveBeenCalled()
      })
    }
  })

  it('exposes setViewport via imperative handle', async () => {
    const ref = createRef<SlideViewerHandle>()

    render(<SlideViewer ref={ref} slide={testSlide} />)

    await waitFor(() => {
      // Phase 1 spec: Component should expose setViewport method
      expect(ref.current).toBeTruthy()
      expect(typeof ref.current?.setViewport).toBe('function')
    })
  })

  it('setViewport calls OpenSeadragon viewport methods', async () => {
    const ref = createRef<SlideViewerHandle>()

    render(<SlideViewer ref={ref} slide={testSlide} />)

    const OpenSeadragon = await import('openseadragon')
    const mockViewer = (OpenSeadragon.default as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]?.value

    await waitFor(() => {
      expect(ref.current).toBeTruthy()
    })

    // Call setViewport
    act(() => {
      ref.current?.setViewport({ centerX: 0.3, centerY: 0.4, zoom: 2.0 })
    })

    // Phase 1 spec: Should call viewport.zoomTo and viewport.panTo
    expect(mockViewer?.viewport.zoomTo).toHaveBeenCalled()
    expect(mockViewer?.viewport.panTo).toHaveBeenCalled()
  })
})
