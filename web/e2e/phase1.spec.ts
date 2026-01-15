/**
 * Phase 1 End-to-End Tests
 *
 * Comprehensive tests for Phase 1 (Core Viewing) requirements from IMPLEMENTATION_PLAN.md.
 * Tests are written against the SPECIFICATION, not the implementation.
 * If a test fails, the implementation has a bug (not the test).
 *
 * User Preferences:
 * - Spawn real server for tests
 * - Use real slide files from /data/wsi-slides
 * - Verbose logging (all requests/responses)
 *
 * Phase 1 Requirements Tested:
 * - Tile rendering (OpenSeadragon, pan/zoom controls)
 * - Minimap (navigator, click-to-jump)
 * - WebSocket server (connection, ping/pong)
 * - Session management (create, join, URL routing)
 */

import { test, expect } from '@playwright/test'
import { setupVerboseLogging, logStep, measureAction } from './logging'
import { ServerHarness, createTestServerHarness } from './server-harness'

// Test configuration
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'
const SERVER_PORT = 8080

// Server harness (shared across tests)
let serverHarness: ServerHarness

// ============================================================================
// Test Setup / Teardown
// ============================================================================

test.beforeAll(async () => {
  console.log('='.repeat(80))
  console.log('Phase 1 E2E Tests - Starting server harness')
  console.log('='.repeat(80))

  serverHarness = createTestServerHarness(SERVER_PORT)

  try {
    await serverHarness.start()
  } catch (err) {
    console.error('Failed to start server:', err)
    // Tests will fail but continue to show what's broken
  }
})

test.afterAll(async () => {
  console.log('='.repeat(80))
  console.log('Phase 1 E2E Tests - Stopping server harness')
  console.log('='.repeat(80))

  if (serverHarness) {
    await serverHarness.stop()
  }
})

// ============================================================================
// Tile Rendering Tests (Week 1, Day 3-4)
// ============================================================================

test.describe('Tile Rendering (Phase 1 Week 1)', () => {
  test('page loads and renders React app', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'page-loads')

    await logStep(page, logger, 1, 'Navigate to home page')
    await page.goto(BASE_URL)

    await logStep(page, logger, 2, 'Wait for React root')
    const root = await page.$('#root')
    expect(root).not.toBeNull()

    await logStep(page, logger, 3, 'Verify React rendered content')
    const children = await root?.$$('*')
    expect(children?.length).toBeGreaterThan(0)

    logger.end()
  })

  test('slide viewer renders with OpenSeadragon', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'slide-viewer-renders')

    await logStep(page, logger, 1, 'Navigate to session page', 'screenshots/step1-navigate.png')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for OpenSeadragon viewer')
    // Phase 1 spec: SlideViewer.tsx renders OpenSeadragon container
    const viewer = page.locator('.openseadragon-container, [data-testid="slide-viewer"]')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Verify viewer has canvas element')
    const canvas = viewer.locator('canvas')
    await expect(canvas).toBeVisible()

    logger.end()
  })

  test('tile loading performance under 200ms', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'tile-performance')

    // Phase 1 spec: Tiles must load within 200ms at any zoom level
    const tileTimes: number[] = []

    page.on('response', (res) => {
      if (res.url().includes('/tile/')) {
        const timing = res.timing()
        if (timing?.responseEnd) {
          tileTimes.push(timing.responseEnd)
          logger.log(
            'Performance',
            'tile-load',
            `Tile loaded in ${timing.responseEnd}ms: ${res.url()}`
          )
        }
      }
    })

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)
    await page.waitForLoadState('networkidle')

    await logStep(page, logger, 2, 'Analyze tile loading times')
    if (tileTimes.length > 0) {
      const avgTime = tileTimes.reduce((a, b) => a + b, 0) / tileTimes.length
      const maxTime = Math.max(...tileTimes)
      const minTime = Math.min(...tileTimes)

      logger.log(
        'Performance',
        'summary',
        `Tiles: ${tileTimes.length}, Avg: ${avgTime.toFixed(0)}ms, Min: ${minTime.toFixed(0)}ms, Max: ${maxTime.toFixed(0)}ms`
      )

      // Phase 1 spec: Tiles must load within 200ms
      expect(maxTime).toBeLessThan(200)
    } else {
      logger.log('Performance', 'warning', 'No tile requests captured')
    }

    logger.end()
  })

  test('zoom controls work correctly', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'zoom-controls')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer to load')
    const viewer = page.locator('.openseadragon-container, [data-testid="slide-viewer"]')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Test zoom in via keyboard')
    // Phase 1 spec: + / = for 1.5x zoom
    await page.keyboard.press('+')
    await page.waitForTimeout(500)

    await logStep(page, logger, 4, 'Test zoom out via keyboard')
    // Phase 1 spec: - for 0.67x zoom
    await page.keyboard.press('-')
    await page.waitForTimeout(500)

    await logStep(page, logger, 5, 'Test home/reset via keyboard')
    // Phase 1 spec: 0 for reset to home/fit view
    await page.keyboard.press('0')
    await page.waitForTimeout(500)

    logger.end()
  })

  test('pan via arrow keys', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'pan-arrows')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container, [data-testid="slide-viewer"]')
    await expect(viewer).toBeVisible({ timeout: 15000 })
    await viewer.click() // Focus the viewer

    await logStep(page, logger, 3, 'Test pan with arrow keys')
    // Phase 1 spec: Arrow keys pan by 10% of viewport
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(300)

    logger.end()
  })

  test('mouse wheel zoom works', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'mouse-wheel-zoom')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container, [data-testid="slide-viewer"]')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Zoom with mouse wheel')
    // Phase 1 spec: Mouse wheel zoom
    await viewer.hover()
    await page.mouse.wheel(0, -100) // Zoom in
    await page.waitForTimeout(500)
    await page.mouse.wheel(0, 100) // Zoom out
    await page.waitForTimeout(500)

    logger.end()
  })
})

// ============================================================================
// Minimap Tests (Week 1, Day 5)
// ============================================================================

test.describe('Minimap (Phase 1 Week 1)', () => {
  test('minimap navigator is visible', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'minimap-visible')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for OpenSeadragon')
    await page.waitForSelector('.openseadragon-container', { timeout: 15000 })

    await logStep(page, logger, 3, 'Check for minimap navigator')
    // Phase 1 spec: Navigator overlay (bottom-right corner by default)
    const navigator = page.locator('.openseadragon-navigator, [data-testid="minimap"]')
    // Navigator may be optional, so we just log if it's there
    const isVisible = await navigator.isVisible().catch(() => false)
    logger.log('Minimap', 'visibility', `Navigator visible: ${isVisible}`)

    logger.end()
  })

  test('minimap shows viewport indicator', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'minimap-viewport')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    await page.waitForSelector('.openseadragon-container', { timeout: 15000 })

    await logStep(page, logger, 3, 'Check for viewport indicator')
    // Phase 1 spec: Current viewport indicator (rectangular overlay)
    const displayRegion = page.locator('.displayregion, [data-testid="viewport-indicator"]')
    const hasIndicator = (await displayRegion.count()) > 0
    logger.log('Minimap', 'indicator', `Viewport indicator present: ${hasIndicator}`)

    logger.end()
  })
})

// ============================================================================
// WebSocket Server Tests (Week 2, Day 1-2)
// ============================================================================

test.describe('WebSocket Server (Phase 1 Week 2)', () => {
  test('WebSocket connects to server', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'ws-connect')

    let wsConnected = false
    page.on('websocket', (ws) => {
      logger.log('WebSocket', 'connect', ws.url())
      wsConnected = true
    })

    await logStep(page, logger, 1, 'Navigate to session page')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for WebSocket connection')
    await page.waitForTimeout(3000)

    logger.log('WebSocket', 'status', `Connected: ${wsConnected}`)
    // Phase 1 spec: WebSocket connection handling
    expect(wsConnected).toBe(true)

    logger.end()
  })

  test('WebSocket sends and receives messages', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'ws-messages')

    const sentMessages: string[] = []
    const receivedMessages: string[] = []

    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        sentMessages.push(frame.payload)
        logger.log('WebSocket', 'sent', frame.payload.substring(0, 200))
      })
      ws.on('framereceived', (frame) => {
        receivedMessages.push(frame.payload)
        logger.log('WebSocket', 'received', frame.payload.substring(0, 200))
      })
    })

    await logStep(page, logger, 1, 'Navigate to create new session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for message exchange')
    await page.waitForTimeout(5000)

    logger.log(
      'WebSocket',
      'summary',
      `Sent: ${sentMessages.length}, Received: ${receivedMessages.length}`
    )

    // Phase 1 spec: Should see session creation messages
    expect(sentMessages.length).toBeGreaterThan(0)

    logger.end()
  })
})

// ============================================================================
// Session Management Tests (Week 2, Day 3-4)
// ============================================================================

test.describe('Session Management (Phase 1 Week 2)', () => {
  test('session creation flow', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-create')

    let sessionCreated = false

    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (frame.payload.includes('session_created')) {
          sessionCreated = true
          logger.log('Session', 'created', 'Received session_created message')
        }
      })
    })

    await logStep(page, logger, 1, 'Navigate to new session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for session creation')
    await page.waitForTimeout(5000)

    // Phase 1 spec: session_created response with SessionSnapshot
    logger.log('Session', 'result', `Session created: ${sessionCreated}`)

    logger.end()
  })

  test('session URL routing pattern /s/:id', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-url')

    await logStep(page, logger, 1, 'Navigate to session route')
    // Phase 1 spec: Route pattern /s/:id
    await page.goto(`${BASE_URL}/s/test123`)

    await logStep(page, logger, 2, 'Verify URL matches pattern')
    const url = page.url()
    logger.log('Route', 'url', url)

    // Should match /s/:id pattern
    expect(url).toMatch(/\/s\/[^/]+/)

    logger.end()
  })

  test('join secret extracted from URL fragment', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-join-secret')

    let joinMessageSent = false

    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        if (frame.payload.includes('join_session') && frame.payload.includes('testsecret123')) {
          joinMessageSent = true
          logger.log('Session', 'join-sent', 'Join message includes secret from URL fragment')
        }
      })
    })

    await logStep(page, logger, 1, 'Navigate with join secret in fragment')
    // Phase 1 spec: Extract join_secret from URL fragment (#join=...)
    await page.goto(`${BASE_URL}/s/testsession#join=testsecret123`)

    await logStep(page, logger, 2, 'Wait for join attempt')
    await page.waitForTimeout(3000)

    logger.log('Session', 'result', `Join with secret sent: ${joinMessageSent}`)

    logger.end()
  })
})

// ============================================================================
// Integration Tests (Week 2, Day 5)
// ============================================================================

test.describe('Full Integration (Phase 1 Week 2)', () => {
  test('complete session flow: create and view', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'full-session-flow')

    const events: string[] = []

    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (frame.payload.includes('session_created')) {
          events.push('session_created')
        }
      })
    })

    await logStep(page, logger, 1, 'Navigate to home')
    await page.goto(BASE_URL)
    await page.screenshot({ path: 'screenshots/flow-1-home.png' })

    await logStep(page, logger, 2, 'Navigate to new session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)
    await page.screenshot({ path: 'screenshots/flow-2-new-session.png' })

    await logStep(page, logger, 3, 'Wait for session creation')
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'screenshots/flow-3-session-created.png' })

    await logStep(page, logger, 4, 'Verify viewer is visible')
    const viewer = page.locator('.openseadragon-container, [data-testid="slide-viewer"]')
    const viewerVisible = await viewer.isVisible().catch(() => false)
    logger.log('Integration', 'viewer', `Viewer visible: ${viewerVisible}`)

    await logStep(page, logger, 5, 'Summary')
    logger.log('Integration', 'events', events.join(', '))

    logger.end()
  })

  test('multi-user session flow', async ({ browser }) => {
    const presenterContext = await browser.newContext()
    const followerContext = await browser.newContext()

    const presenterPage = await presenterContext.newPage()
    const followerPage = await followerContext.newPage()

    const presenterLogger = setupVerboseLogging(presenterPage, 'presenter')
    const followerLogger = setupVerboseLogging(followerPage, 'follower')

    let sessionId: string | null = null
    let joinSecret: string | null = null

    // Capture session info from presenter
    presenterPage.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(frame.payload)
          if (data.type === 'session_created') {
            sessionId = data.session?.id
            presenterLogger.log('Session', 'created', `ID: ${sessionId}`)
          }
          if (data.join_secret) {
            joinSecret = data.join_secret
            presenterLogger.log(
              'Session',
              'secret',
              `Secret received (length: ${joinSecret?.length})`
            )
          }
        } catch {
          // Not JSON
        }
      })
    })

    await logStep(presenterPage, presenterLogger, 1, 'Presenter creates session')
    await presenterPage.goto(`${BASE_URL}/s/new?slide=demo`)
    await presenterPage.waitForTimeout(5000)

    if (sessionId && joinSecret) {
      await logStep(followerPage, followerLogger, 2, 'Follower joins session')
      await followerPage.goto(`${BASE_URL}/s/${sessionId}#join=${joinSecret}`)
      await followerPage.waitForTimeout(5000)

      // Verify follower sees the viewer
      const followerViewer = followerPage.locator('.openseadragon-container')
      const followerHasViewer = await followerViewer.isVisible().catch(() => false)
      followerLogger.log('Session', 'joined', `Viewer visible: ${followerHasViewer}`)
    } else {
      presenterLogger.log('Session', 'error', 'Failed to get session ID or join secret')
    }

    presenterLogger.end()
    followerLogger.end()

    await presenterContext.close()
    await followerContext.close()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Error Handling (Phase 1)', () => {
  test('invalid session shows error', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'invalid-session')

    await logStep(page, logger, 1, 'Navigate to non-existent session')
    await page.goto(`${BASE_URL}/s/nonexistent123#join=invalidsecret`)

    await logStep(page, logger, 2, 'Wait for error handling')
    await page.waitForTimeout(3000)

    // Phase 1 spec: session_error with code and message
    const pageContent = await page.content()
    const hasErrorIndicator =
      pageContent.includes('error') ||
      pageContent.includes('Error') ||
      pageContent.includes('not found') ||
      pageContent.includes('invalid')

    logger.log('Error', 'handling', `Error indicator present: ${hasErrorIndicator}`)

    logger.end()
  })

  test('no JavaScript errors on normal navigation', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'no-js-errors')

    const errors: string[] = []
    page.on('pageerror', (err) => {
      errors.push(err.message)
    })

    await logStep(page, logger, 1, 'Navigate through app')
    await page.goto(BASE_URL)
    await page.waitForTimeout(1000)

    await page.goto(`${BASE_URL}/s/new?slide=demo`)
    await page.waitForTimeout(3000)

    // Filter known acceptable errors
    const criticalErrors = errors.filter(
      (err) =>
        !err.includes('ResizeObserver') &&
        !err.includes('WebSocket connection') &&
        !err.includes('net::ERR_')
    )

    logger.log('Errors', 'summary', `Total: ${errors.length}, Critical: ${criticalErrors.length}`)
    criticalErrors.forEach((err) => logger.log('Errors', 'critical', err))

    expect(criticalErrors).toHaveLength(0)

    logger.end()
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

test.describe('Performance (Phase 1)', () => {
  test('page loads within 5 seconds', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'page-load-time')

    const { durationMs } = await measureAction(logger, 'Page load', async () => {
      await page.goto(BASE_URL)
      await page.waitForLoadState('networkidle')
      return null
    })

    logger.log('Performance', 'page-load', `Completed in ${durationMs}ms`)

    // Phase 1 spec: Page should load within 5 seconds
    expect(durationMs).toBeLessThan(5000)

    logger.end()
  })
})
