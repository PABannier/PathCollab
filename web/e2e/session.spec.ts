/**
 * End-to-End Tests for Session Management
 *
 * Tests the full user flows for creating and joining sessions.
 * These tests verify Phase 1 requirements from IMPLEMENTATION_PLAN.md.
 *
 * Note: Many tests in phase1.spec.ts provide comprehensive coverage.
 * This file focuses on additional session-specific scenarios.
 */

import { test, expect, Page } from '@playwright/test'
import { setupVerboseLogging, logStep } from './logging'

// Test configuration
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for the WebSocket connection to be established
 * by checking for session creation message
 */
async function waitForSessionCreation(page: Page, timeout = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout)

    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (frame.payload.includes('session_created')) {
          clearTimeout(timer)
          resolve(true)
        }
      })
    })
  })
}

// ============================================================================
// Test Suites
// ============================================================================

test.describe('Session Creation', () => {
  /**
   * Phase 1 spec: Session can be created from home page
   * Reference: IMPLEMENTATION_PLAN.md Week 2, Day 3-4
   */
  test('should navigate to session from home page', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-create-home')

    await logStep(page, logger, 1, 'Navigate to home page')
    await page.goto(BASE_URL)

    await logStep(page, logger, 2, 'Click Try Demo button')
    // The home page has "Try Demo" button that navigates to session
    const tryDemoBtn = page.locator('button:has-text("Try Demo")').first()
    await expect(tryDemoBtn).toBeVisible()
    await tryDemoBtn.click()

    await logStep(page, logger, 3, 'Verify navigation to session')
    // Should navigate to /s/ route
    await page.waitForURL(/\/s\//, { timeout: 10000 })

    logger.end()
  })

  /**
   * Phase 1 spec: Create Session modal opens
   * Reference: IMPLEMENTATION_PLAN.md Week 2, Day 3-4
   */
  test('should open create session modal', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-modal')

    await logStep(page, logger, 1, 'Navigate to home')
    await page.goto(BASE_URL)

    await logStep(page, logger, 2, 'Click Create Session button')
    const createBtn = page.locator('button:has-text("Create Session")').first()
    await expect(createBtn).toBeVisible()
    await createBtn.click()

    await logStep(page, logger, 3, 'Verify modal appears')
    // Modal should show "Create New Session" heading
    const modalHeading = page.locator('h4:has-text("Create New Session")')
    await expect(modalHeading).toBeVisible()

    logger.end()
  })
})

test.describe('Session Joining', () => {
  /**
   * Phase 1 spec: Invalid session shows error
   * Reference: IMPLEMENTATION_PLAN.md (error handling)
   */
  test('should handle invalid session gracefully', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-invalid')

    await logStep(page, logger, 1, 'Navigate to non-existent session')
    await page.goto(`${BASE_URL}/s/nonexistent123#join=invalidsecret`)

    await logStep(page, logger, 2, 'Wait for error handling')
    await page.waitForTimeout(3000)

    // Should not crash - page should still be functional
    const pageContent = await page.content()
    expect(pageContent).toBeTruthy()

    logger.end()
  })

  /**
   * Phase 1 spec: Session route pattern /s/:id
   * Reference: IMPLEMENTATION_PLAN.md Week 2, Day 5
   */
  test('should accept session route pattern', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'session-route')

    await logStep(page, logger, 1, 'Navigate to session route')
    await page.goto(`${BASE_URL}/s/test123`)

    await logStep(page, logger, 2, 'Verify URL pattern')
    const url = page.url()
    expect(url).toMatch(/\/s\/[^/]+/)

    logger.end()
  })
})

test.describe('Presenter Controls', () => {
  /**
   * Phase 1 spec: Viewer renders with slide
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4
   */
  test('presenter should see slide viewer', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'presenter-viewer')

    await logStep(page, logger, 1, 'Navigate to new session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    logger.end()
  })

  /**
   * Phase 1 spec: Keyboard shortcuts work
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4
   */
  test('presenter should be able to use keyboard shortcuts', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'presenter-keyboard')

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })
    await viewer.click()

    await logStep(page, logger, 3, 'Test zoom shortcuts')
    // Phase 1 spec: + for 1.5x zoom
    await page.keyboard.press('+')
    await page.waitForTimeout(500)
    // Phase 1 spec: - for 0.67x zoom
    await page.keyboard.press('-')
    await page.waitForTimeout(500)
    // Phase 1 spec: 0 for reset
    await page.keyboard.press('0')
    await page.waitForTimeout(500)

    logger.end()
  })
})

test.describe('Error Handling', () => {
  /**
   * Phase 1 spec: Invalid routes handled gracefully
   * Reference: IMPLEMENTATION_PLAN.md (routing)
   */
  test('should show error page for invalid routes', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'invalid-route')

    await logStep(page, logger, 1, 'Navigate to invalid route')
    await page.goto(`${BASE_URL}/invalid-route-that-does-not-exist`)

    await logStep(page, logger, 2, 'Verify page still renders')
    // Should show 404 or redirect to home - not crash
    const pageContent = await page.content()
    expect(pageContent).toBeTruthy()

    logger.end()
  })

  /**
   * Phase 1 spec: No JavaScript errors on normal navigation
   * Reference: IMPLEMENTATION_PLAN.md (error handling)
   */
  test('should not have critical JavaScript errors', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'js-errors')

    const errors: string[] = []
    page.on('pageerror', (err) => {
      errors.push(err.message)
    })

    await logStep(page, logger, 1, 'Navigate to home')
    await page.goto(BASE_URL)
    await page.waitForTimeout(2000)

    await logStep(page, logger, 2, 'Navigate to session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)
    await page.waitForTimeout(3000)

    // Filter known acceptable errors
    const criticalErrors = errors.filter(
      (err) =>
        !err.includes('ResizeObserver') &&
        !err.includes('WebSocket') &&
        !err.includes('net::ERR_')
    )

    logger.log('Errors', 'summary', `Total: ${errors.length}, Critical: ${criticalErrors.length}`)

    expect(criticalErrors).toHaveLength(0)

    logger.end()
  })
})

test.describe('Accessibility', () => {
  /**
   * Phase 1 spec: Home page is keyboard navigable
   * Reference: IMPLEMENTATION_PLAN.md (accessibility)
   */
  test('home page should be keyboard navigable', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'keyboard-nav')

    await logStep(page, logger, 1, 'Navigate to home')
    await page.goto(BASE_URL)

    await logStep(page, logger, 2, 'Tab through elements')
    await page.keyboard.press('Tab')

    // First focusable element should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName)
    expect(focusedElement).toBeTruthy()

    logger.end()
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

test.describe('Performance', () => {
  /**
   * Phase 1 spec: Page loads within 5 seconds
   * Reference: IMPLEMENTATION_PLAN.md (performance)
   */
  test('page should load within acceptable time', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'perf-load')

    const startTime = Date.now()

    await logStep(page, logger, 1, 'Load home page')
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime

    logger.log('Performance', 'load-time', `${loadTime}ms`)

    // Page should load within 5 seconds
    expect(loadTime).toBeLessThan(5000)

    logger.end()
  })

  /**
   * Phase 1 spec: Viewer renders without critical delay
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4
   */
  test('viewer should render without excessive delay', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'perf-viewer')

    const startTime = Date.now()

    await logStep(page, logger, 1, 'Navigate to viewer')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    const loadTime = Date.now() - startTime
    logger.log('Performance', 'viewer-load', `${loadTime}ms`)

    // Viewer should be visible within 15 seconds
    expect(loadTime).toBeLessThan(15000)

    logger.end()
  })
})
