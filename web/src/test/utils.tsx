/**
 * Test Utilities
 *
 * Helper functions for rendering components and mocking dependencies.
 */

import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { vi, type Mock } from 'vitest'

// ============================================================================
// Custom Render with Providers
// ============================================================================

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  useMemoryRouter?: boolean
}

/**
 * Render a component wrapped in necessary providers (Router, etc.)
 */
export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult {
  const { route = '/', useMemoryRouter = true, ...renderOptions } = options

  const Wrapper = ({ children }: { children: ReactNode }) => {
    if (useMemoryRouter) {
      return <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    }
    return <BrowserRouter>{children}</BrowserRouter>
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

// ============================================================================
// Mock WebSocket
// ============================================================================

interface MockWebSocketMessage {
  type: string
  [key: string]: unknown
}

export interface MockWebSocketInstance {
  url: string
  readyState: number
  onopen: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send: Mock
  close: Mock
  // Test helpers
  simulateOpen: () => void
  simulateClose: (code?: number, reason?: string) => void
  simulateMessage: (data: MockWebSocketMessage) => void
  simulateError: () => void
  getSentMessages: () => MockWebSocketMessage[]
}

/**
 * Create a mock WebSocket instance for testing
 */
export function createMockWebSocket(): MockWebSocketInstance {
  const sentMessages: string[] = []

  const mockWs: MockWebSocketInstance = {
    url: '',
    readyState: WebSocket.CONNECTING,
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,

    send: vi.fn((data: string) => {
      if (mockWs.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not open')
      }
      sentMessages.push(data)
    }),

    close: vi.fn((code?: number, reason?: string) => {
      mockWs.readyState = WebSocket.CLOSING
      setTimeout(() => {
        mockWs.readyState = WebSocket.CLOSED
        mockWs.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason }))
      }, 0)
    }),

    // Test helpers
    simulateOpen: () => {
      mockWs.readyState = WebSocket.OPEN
      mockWs.onopen?.(new Event('open'))
    },

    simulateClose: (code = 1000, reason = '') => {
      mockWs.readyState = WebSocket.CLOSED
      mockWs.onclose?.(new CloseEvent('close', { code, reason }))
    },

    simulateMessage: (data: MockWebSocketMessage) => {
      mockWs.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
    },

    simulateError: () => {
      mockWs.onerror?.(new Event('error'))
    },

    getSentMessages: () => {
      return sentMessages.map((msg) => JSON.parse(msg) as MockWebSocketMessage)
    },
  }

  return mockWs
}

/**
 * Install a mock WebSocket globalThisly
 */
export function installMockWebSocket(): {
  getInstance: () => MockWebSocketInstance | null
  restore: () => void
} {
  let instance: MockWebSocketInstance | null = null
  const OriginalWebSocket = globalThis.WebSocket

  // @ts-expect-error - Mocking WebSocket constructor
  globalThis.WebSocket = class MockWebSocket {
    constructor(url: string) {
      instance = createMockWebSocket()
      instance.url = url
      // Simulate async connection
      setTimeout(() => instance?.simulateOpen(), 0)
      return instance
    }

    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
  }

  return {
    getInstance: () => instance,
    restore: () => {
      globalThis.WebSocket = OriginalWebSocket
      instance = null
    },
  }
}

// ============================================================================
// Mock Fetch
// ============================================================================

interface MockFetchResponse {
  ok?: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  json?: () => Promise<unknown>
  text?: () => Promise<string>
  arrayBuffer?: () => Promise<ArrayBuffer>
}

interface MockFetchOptions {
  [urlPattern: string]: MockFetchResponse | ((url: string, init?: RequestInit) => MockFetchResponse)
}

/**
 * Install mock fetch with predefined responses
 */
export function installMockFetch(options: MockFetchOptions): {
  getCalls: () => Array<{ url: string; init?: RequestInit }>
  restore: () => void
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })

    // Find matching pattern
    for (const [pattern, response] of Object.entries(options)) {
      if (url.includes(pattern) || new RegExp(pattern).test(url)) {
        const resolved = typeof response === 'function' ? response(url, init) : response

        return {
          ok: resolved.ok ?? true,
          status: resolved.status ?? 200,
          statusText: resolved.statusText ?? 'OK',
          headers: new Headers(resolved.headers ?? {}),
          json: resolved.json ?? (() => Promise.resolve({})),
          text: resolved.text ?? (() => Promise.resolve('')),
          arrayBuffer: resolved.arrayBuffer ?? (() => Promise.resolve(new ArrayBuffer(0))),
        } as Response
      }
    }

    // Default 404 for unmatched URLs
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'Not Found' }),
      text: () => Promise.resolve('Not Found'),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response
  }) as typeof fetch

  return {
    getCalls: () => calls,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create a mock PointerEvent
 */
export function createPointerEvent(
  type: string,
  options: Partial<PointerEventInit> = {}
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    ...options,
  })
}

/**
 * Create a mock MouseEvent
 */
export function createMouseEvent(type: string, options: Partial<MouseEventInit> = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    ...options,
  })
}

/**
 * Create a mock KeyboardEvent
 */
export function createKeyboardEvent(
  type: string,
  options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options,
  })
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for a specified number of milliseconds
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Wait for a condition to be true
 */
export async function waitForCondition(
  condition: () => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options
  const start = Date.now()

  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition')
    }
    await waitFor(interval)
  }
}

// ============================================================================
// File/Upload Helpers
// ============================================================================

/**
 * Create a mock File object
 */
export function createMockFile(
  name: string,
  content: string | ArrayBuffer = '',
  type = 'application/octet-stream'
): File {
  const blob =
    typeof content === 'string' ? new Blob([content], { type }) : new Blob([content], { type })
  return new File([blob], name, { type })
}

/**
 * Create a mock protobuf file for testing uploads
 */
export function createMockProtobufFile(sizeBytes = 1024): File {
  const content = new ArrayBuffer(sizeBytes)
  return createMockFile('test-overlay.pb', content, 'application/octet-stream')
}

// ============================================================================
// Timer Helpers
// ============================================================================

/**
 * Advance timers and flush promises
 */
export async function advanceTimersAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await flushPromises()
}

// ============================================================================
// Re-export testing library utilities
// ============================================================================

export {
  render,
  screen,
  fireEvent,
  waitFor as waitForElement,
  within,
} from '@testing-library/react'
export { userEvent } from '@testing-library/user-event'
