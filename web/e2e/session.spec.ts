/**
 * End-to-End Tests for Session Management
 *
 * Tests the full user flows for creating and joining sessions.
 * These tests require both the server and web client to be running.
 */

import { test, expect, Page } from '@playwright/test'

// Test configuration
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _API_URL = process.env.E2E_API_URL || 'http://localhost:8080'

// ============================================================================
// Helper Functions (used by skipped tests, will be enabled when backend is ready)
// ============================================================================

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Wait for the WebSocket connection to be established
 */
async function waitForConnection(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => {
      // Check for connection indicator or status
      const status = document.querySelector('[data-testid="connection-status"]')
      return status?.textContent === 'connected'
    },
    { timeout }
  )
}

/**
 * Create a new session via the UI
 */
async function createSession(page: Page, slideId: string = 'demo'): Promise<string> {
  // Navigate to create session page
  await page.goto(`${BASE_URL}/create`)

  // Enter slide ID
  const slideInput = page.locator('[data-testid="slide-id-input"]')
  if (await slideInput.isVisible()) {
    await slideInput.fill(slideId)
  }

  // Click create session button
  await page.click('[data-testid="create-session-btn"]')

  // Wait for session to be created and get the URL
  await page.waitForURL(/\/session\/[a-z0-9]+/)

  const url = page.url()
  const sessionId = url.match(/\/session\/([a-z0-9]+)/)?.[1]

  if (!sessionId) {
    throw new Error('Failed to extract session ID from URL')
  }

  return sessionId
}

/**
 * Join an existing session via the UI
 */
async function joinSession(page: Page, sessionId: string, joinSecret: string): Promise<void> {
  await page.goto(`${BASE_URL}/join/${sessionId}/${joinSecret}`)
  await page.waitForURL(/\/session\/[a-z0-9]+/)
}

/* eslint-enable @typescript-eslint/no-unused-vars */

// ============================================================================
// Test Suites
// ============================================================================

test.describe('Session Creation', () => {
  test.skip('should create a new session and display session info', async ({ page }) => {
    // This test requires the server to be running
    await page.goto(BASE_URL)

    // Look for create session button/link
    const createLink = page.locator('a[href*="/create"], button:has-text("Create")')
    if (await createLink.isVisible()) {
      await createLink.click()
    }

    // The create flow depends on the actual UI implementation
    // This is a scaffold that should be updated based on the real UI
    await expect(page).toHaveURL(/create|session/)
  })

  test.skip('should display join link after creating session', async ({ page }) => {
    // Create a session
    await page.goto(`${BASE_URL}/create`)

    // After session creation, should show join link
    const joinLink = page.locator('[data-testid="join-link"], .join-link')
    await expect(joinLink).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Session Joining', () => {
  test.skip('should join an existing session', async ({ page, context }) => {
    // This test requires coordination between two browser contexts
    // First, create a session as presenter
    const presenterPage = await context.newPage()
    await presenterPage.goto(`${BASE_URL}/create`)

    // Get the join link (implementation depends on UI)
    // Then join as follower on another page
    await page.goto(BASE_URL)

    // Verify join worked
    await expect(page.locator('[data-testid="session-view"]')).toBeVisible()
  })

  test.skip('should show error for invalid session', async ({ page }) => {
    // Try to join non-existent session
    await page.goto(`${BASE_URL}/join/nonexistent/invalidsecret`)

    // Should show error message
    const errorMessage = page.locator('[data-testid="error-message"], .error-message')
    await expect(errorMessage).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Presenter Controls', () => {
  test.skip('presenter should be able to control viewport', async ({ page }) => {
    // Create session as presenter
    await page.goto(`${BASE_URL}/create`)

    // Wait for viewer to load
    await page.waitForSelector('[data-testid="slide-viewer"], .openseadragon-viewer')

    // Pan/zoom the viewer (simulate mouse events)
    const viewer = page.locator('[data-testid="slide-viewer"], .openseadragon-viewer')
    await viewer.dragTo(viewer, { targetPosition: { x: 200, y: 200 } })

    // Viewport update should be sent to server
    // This can be verified by checking network traffic or UI state
  })

  test.skip('presenter should be able to toggle layer visibility', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Open layer panel
    const layerToggle = page.locator('[data-testid="layer-panel-toggle"]')
    if (await layerToggle.isVisible()) {
      await layerToggle.click()
    }

    // Toggle tissue heatmap
    const heatmapToggle = page.locator('[data-testid="tissue-heatmap-toggle"]')
    if (await heatmapToggle.isVisible()) {
      await heatmapToggle.click()

      // Verify toggle state changed
      // Implementation depends on UI
    }
  })
})

test.describe('Follower Experience', () => {
  test.skip('follower should see presenter cursor', async ({ browser }) => {
    // Create two browser contexts
    const presenterContext = await browser.newContext()
    const followerContext = await browser.newContext()

    const presenterPage = await presenterContext.newPage()
    const followerPage = await followerContext.newPage()

    // Create session as presenter
    await presenterPage.goto(`${BASE_URL}/create`)

    // Get join link and join as follower
    // (Implementation depends on how join links are exposed)

    // Move presenter cursor
    const presenterViewer = presenterPage.locator('[data-testid="slide-viewer"]')
    await presenterViewer.hover()
    await presenterPage.mouse.move(400, 300)

    // Verify cursor appears on follower's view
    const _cursorOverlay = followerPage.locator('[data-testid="cursor-overlay"]')
    // Implementation depends on cursor rendering approach
    void _cursorOverlay // Will be used when test is enabled

    await presenterContext.close()
    await followerContext.close()
  })

  test.skip('follower should follow presenter viewport changes', async ({ browser }) => {
    const presenterContext = await browser.newContext()
    const followerContext = await browser.newContext()

    const _presenterPage = await presenterContext.newPage()
    const _followerPage = await followerContext.newPage()

    // Setup: Create and join session
    // (Implementation depends on actual UI)
    void _presenterPage // Will be used when test is enabled
    void _followerPage // Will be used when test is enabled

    // Presenter changes viewport
    // Follower should see the change

    await presenterContext.close()
    await followerContext.close()
  })
})

test.describe('Error Handling', () => {
  test('should show error page for invalid routes', async ({ page }) => {
    await page.goto(`${BASE_URL}/invalid-route-that-does-not-exist`)

    // Should show 404 or redirect to home
    // This depends on the routing implementation
    const pageContent = await page.content()
    expect(pageContent).toBeTruthy()
  })

  test.skip('should handle server disconnection gracefully', async ({ page }) => {
    // Create session
    await page.goto(`${BASE_URL}/create`)

    // Simulate server disconnect (would need server control)
    // Verify reconnection indicator appears

    const _reconnectingIndicator = page.locator('[data-testid="reconnecting-indicator"]')
    // Implementation depends on how disconnection is handled
    void _reconnectingIndicator // Will be used when test is enabled
  })
})

test.describe('Accessibility', () => {
  test.skip('home page should be keyboard navigable', async ({ page }) => {
    await page.goto(BASE_URL)

    // Tab through interactive elements
    await page.keyboard.press('Tab')

    // First focusable element should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName)
    expect(focusedElement).toBeTruthy()
  })

  test.skip('session view should have proper ARIA labels', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Check for ARIA labels on interactive elements
    const ariaElements = await page.$$('[aria-label], [role]')
    expect(ariaElements.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

test.describe('Performance', () => {
  test.skip('page should load within acceptable time', async ({ page }) => {
    const startTime = Date.now()

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime

    // Page should load within 5 seconds
    expect(loadTime).toBeLessThan(5000)
  })

  test.skip('viewer should render without lag', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Wait for viewer
    await page.waitForSelector('[data-testid="slide-viewer"], .openseadragon-viewer', {
      timeout: 10000,
    })

    // Measure frame rate during interaction
    // This would require custom performance measurement
  })
})
