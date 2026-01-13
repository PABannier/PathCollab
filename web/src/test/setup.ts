/**
 * Vitest Setup File
 *
 * This file runs before each test file. It configures:
 * - DOM matchers from @testing-library/jest-dom
 * - Global mocks for browser APIs not available in jsdom
 * - Cleanup between tests
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll, vi } from 'vitest'

// Cleanup DOM after each test
afterEach(() => {
  cleanup()
})

// ============================================================================
// Mock Browser APIs not available in jsdom
// ============================================================================

// Mock ResizeObserver (used by OpenSeadragon and many UI libraries)
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

// Mock IntersectionObserver
class MockIntersectionObserver {
  root = null
  rootMargin = ''
  thresholds = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

// Mock matchMedia (used for responsive queries)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock scrollTo (called by various UI components)
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
})

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
})

// ============================================================================
// Mock WebGL (for OverlayCanvas and TissueHeatmapLayer tests)
// ============================================================================

// Create a mock WebGL2 context
function createMockWebGL2Context(): WebGL2RenderingContext {
  const mockBuffer = {} as WebGLBuffer
  const mockProgram = {} as WebGLProgram
  const mockShader = {} as WebGLShader
  const mockTexture = {} as WebGLTexture
  const mockVAO = {} as WebGLVertexArrayObject

  return {
    // Context info
    canvas: document.createElement('canvas'),
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,

    // Shader methods
    createShader: vi.fn(() => mockShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),

    // Program methods
    createProgram: vi.fn(() => mockProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    deleteProgram: vi.fn(),

    // Buffer methods
    createBuffer: vi.fn(() => mockBuffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),

    // Attribute methods
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),

    // Uniform methods
    getUniformLocation: vi.fn(() => ({})),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniformMatrix4fv: vi.fn(),

    // Texture methods
    createTexture: vi.fn(() => mockTexture),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    activeTexture: vi.fn(),
    deleteTexture: vi.fn(),

    // VAO methods
    createVertexArray: vi.fn(() => mockVAO),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),

    // Drawing methods
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    drawElements: vi.fn(),

    // State methods
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),

    // Constants
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    COLOR_BUFFER_BIT: 16384,
  } as unknown as WebGL2RenderingContext
}

// Override canvas getContext to return mock WebGL2
const originalGetContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown
): RenderingContext | null {
  if (contextId === 'webgl2') {
    return createMockWebGL2Context()
  }
  return originalGetContext.call(this, contextId, options as CanvasRenderingContext2DSettings)
} as typeof HTMLCanvasElement.prototype.getContext

// ============================================================================
// Mock fetch for API tests
// ============================================================================

// Store original fetch
const originalFetch = globalThis.fetch

// Restore fetch after all tests
afterAll(() => {
  globalThis.fetch = originalFetch
})

// ============================================================================
// Console error/warning suppression for expected errors
// ============================================================================

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

beforeAll(() => {
  // Suppress specific expected warnings
  console.error = (...args: unknown[]) => {
    const message = args[0]?.toString() || ''
    // Suppress React 18 act() warnings in tests
    if (message.includes('Warning: An update to') && message.includes('was not wrapped in act')) {
      return
    }
    // Suppress WebGL context warnings
    if (message.includes('WebGL')) {
      return
    }
    originalConsoleError.apply(console, args)
  }

  console.warn = (...args: unknown[]) => {
    const message = args[0]?.toString() || ''
    // Suppress specific warnings
    if (message.includes('componentWillReceiveProps')) {
      return
    }
    originalConsoleWarn.apply(console, args)
  }
})

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})

// ============================================================================
// Global test utilities
// ============================================================================

// Helper to wait for async operations
export async function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Helper to flush promises
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
