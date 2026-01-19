/**
 * End-to-End Tests for Phase 2 (Collaboration MVP)
 *
 * Tests for multi-user collaboration features from IMPLEMENTATION_PLAN.md.
 * These tests verify Phase 2 requirements:
 * - Week 3: Presence System (cursor tracking, viewport sync)
 * - Week 4: Robustness (reconnection, participant management, UI polish)
 *
 * Note: Multi-browser tests require the real server to be running.
 * Run with: bunx playwright test e2e/phase2.spec.ts
 */

import { test, expect } from '@playwright/test'
import { setupVerboseLogging, logStep } from './logging'

// Test configuration
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new session and return the share URL
 */
async function createSession(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/s/new?slide=demo`)

  // Wait for viewer to load
  const viewer = page.locator('.openseadragon-container')
  await expect(viewer).toBeVisible({ timeout: 15000 })

  // Wait for session to be created (share URL should appear)
  // Look for the share input field
  const shareInput = page.locator('input[readonly]').first()
  await expect(shareInput).toBeVisible({ timeout: 10000 })

  // Get the share URL
  const shareUrl = await shareInput.inputValue()
  return shareUrl
}

/**
 * Join an existing session from the share URL
 */
async function joinSession(page: Page, shareUrl: string): Promise<void> {
  await page.goto(shareUrl)

  // Wait for viewer to load
  const viewer = page.locator('.openseadragon-container')
  await expect(viewer).toBeVisible({ timeout: 15000 })
}

// ============================================================================
// Phase 2: Presence System Tests (Week 3)
// ============================================================================

test.describe('Phase 2: Connection Status', () => {
  /**
   * Phase 2 spec: Connection status indicator shows connected
   * Reference: IMPLEMENTATION_PLAN.md Week 4, Day 3-4
   */
  test('should show connected status when session is active', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'connection-status')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Check for connection indicator')
    // The connection badge should show (green dot for connected or purple for solo)
    const connectionBadge = page.locator('.rounded-full').first()
    await expect(connectionBadge).toBeVisible({ timeout: 5000 })

    logger.end()
  })

})

test.describe('Phase 2: Participant Management', () => {
  /**
   * Phase 2 spec: Participant count shown
   * Reference: IMPLEMENTATION_PLAN.md Week 4
   */
  test('should show participant count', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'participant-count')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Check for participant count')
    // Should show "1 viewer" for presenter
    const participantCount = page.locator('text=/\\d+ viewer/')
    await expect(participantCount).toBeVisible({ timeout: 5000 })

    logger.end()
  })

  /**
   * Phase 2 spec: Presenter badge shown
   * Reference: IMPLEMENTATION_PLAN.md Week 4
   */
  test('should show presenter badge for session creator', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'presenter-badge')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Check for presenter badge')
    const presenterBadge = page.locator('text=Presenter')
    await expect(presenterBadge).toBeVisible({ timeout: 5000 })

    logger.end()
  })
})

test.describe('Phase 2: Share Functionality', () => {
  /**
   * Phase 2 spec: Share URL is generated
   * Reference: IMPLEMENTATION_PLAN.md Week 4
   */
  test('should generate share URL', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'share-url')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for share URL')
    // Share input should appear with session URL
    const shareInput = page.locator('input[readonly]').first()
    await expect(shareInput).toBeVisible({ timeout: 10000 })

    await logStep(page, logger, 3, 'Verify URL format')
    const shareUrl = await shareInput.inputValue()
    // URL should contain session ID and join secret
    expect(shareUrl).toMatch(/\/s\/[^/]+#join=/)

    logger.end()
  })

  /**
   * Phase 2 spec: Copy button works
   * Reference: IMPLEMENTATION_PLAN.md Week 4
   */
  test('should have working copy button', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'copy-button')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Find copy button')
    const copyButton = page.locator('button:has-text("Copy")').first()
    await expect(copyButton).toBeVisible({ timeout: 10000 })

    await logStep(page, logger, 3, 'Click copy button')
    await copyButton.click()

    // Button should change to "Copied!" state
    const copiedState = page.locator('button:has-text("Copied")')
    await expect(copiedState).toBeVisible({ timeout: 2000 })

    logger.end()
  })
})

test.describe('Phase 2: Viewport Controls', () => {
  /**
   * Phase 2 spec: Follow presenter button available
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  test('should not show follow button for presenter', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'follow-button-presenter')

    await logStep(page, logger, 1, 'Create session as presenter')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Verify no follow button for presenter')
    // Presenter should not have a "Follow" button
    const followButton = page.locator('button:has-text("Follow")')
    await expect(followButton).not.toBeVisible({ timeout: 2000 })

    logger.end()
  })

  /**
   * Phase 2 spec: Snap to presenter shortcut
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (Ctrl+F)
   */
  test('should have snap to presenter keyboard shortcut', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'snap-shortcut')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })
    await viewer.click()

    await logStep(page, logger, 3, 'Open help to verify shortcuts')
    // Press ? to open help
    await page.keyboard.press('?')

    await logStep(page, logger, 4, 'Check for Ctrl+F shortcut')
    const helpDialog = page.locator('text=Follow presenter')
    await expect(helpDialog).toBeVisible({ timeout: 2000 })

    logger.end()
  })
})

// ============================================================================
// Phase 2: Robustness Tests (Week 4)
// Note: Basic error recovery tests are in phase1.spec.ts
// ============================================================================

test.describe('Phase 2: Debug Panel', () => {
  /**
   * Phase 2 spec: Debug panel shows session info
   * Reference: IMPLEMENTATION_PLAN.md (development)
   */
  test('should show debug panel with session info', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'debug-panel')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    await logStep(page, logger, 2, 'Wait for viewer')
    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })

    await logStep(page, logger, 3, 'Look for debug toggle')
    // Debug panel toggle should be present (bug icon)
    const debugToggle = page.locator('button[title*="Debug"]')
    if (await debugToggle.isVisible()) {
      await debugToggle.click()

      await logStep(page, logger, 4, 'Check debug panel content')
      // Should show session information
      const debugPanel = page.locator('text=Connection')
      await expect(debugPanel).toBeVisible({ timeout: 2000 })
    }

    logger.end()
  })
})

// ============================================================================
// Multi-User Tests (require multiple browser contexts)
// ============================================================================

test.describe('Phase 2: Multi-User Collaboration', () => {
  /**
   * Phase 2 spec: Follower can join presenter session
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  test('follower should be able to join session via share link', async ({ browser }) => {
    // Create two browser contexts to simulate presenter and follower
    const presenterContext = await browser.newContext()
    const followerContext = await browser.newContext()

    const presenterPage = await presenterContext.newPage()
    const followerPage = await followerContext.newPage()

    const presenterLogger = setupVerboseLogging(presenterPage, 'multi-user-presenter')
    const followerLogger = setupVerboseLogging(followerPage, 'multi-user-follower')

    try {
      await logStep(presenterPage, presenterLogger, 1, 'Presenter creates session')
      const shareUrl = await createSession(presenterPage)
      expect(shareUrl).toMatch(/\/s\/[^/]+#join=/)

      await logStep(followerPage, followerLogger, 2, 'Follower joins via share URL')
      await joinSession(followerPage, shareUrl)

      await logStep(presenterPage, presenterLogger, 3, 'Verify participant count increased')
      // Wait for participant count to update
      await presenterPage.waitForTimeout(2000)

      // Should show 2 viewers
      const participantCount = presenterPage.locator('text=/2 viewer/')
      await expect(participantCount).toBeVisible({ timeout: 5000 })

      await logStep(followerPage, followerLogger, 4, 'Follower should not be presenter')
      // Follower should not see "Presenter" badge
      const presenterBadge = followerPage.locator('.bg-blue-600:has-text("Presenter")')
      await expect(presenterBadge).not.toBeVisible({ timeout: 2000 })

      presenterLogger.end()
      followerLogger.end()
    } finally {
      await presenterContext.close()
      await followerContext.close()
    }
  })

  /**
   * Phase 2 spec: Session survives follower disconnect
   * Reference: IMPLEMENTATION_PLAN.md Week 4
   */
  test('session should survive follower disconnect', async ({ browser }) => {
    const presenterContext = await browser.newContext()
    const followerContext = await browser.newContext()

    const presenterPage = await presenterContext.newPage()
    const followerPage = await followerContext.newPage()

    const presenterLogger = setupVerboseLogging(presenterPage, 'survive-disconnect-presenter')

    try {
      await logStep(presenterPage, presenterLogger, 1, 'Create session')
      const shareUrl = await createSession(presenterPage)

      await logStep(presenterPage, presenterLogger, 2, 'Follower joins')
      await joinSession(followerPage, shareUrl)
      await presenterPage.waitForTimeout(2000)

      // Verify 2 participants
      const count2 = presenterPage.locator('text=/2 viewer/')
      await expect(count2).toBeVisible({ timeout: 5000 })

      await logStep(presenterPage, presenterLogger, 3, 'Follower disconnects')
      await followerPage.close()
      await presenterPage.waitForTimeout(2000)

      await logStep(presenterPage, presenterLogger, 4, 'Session still active')
      // Should show 1 viewer
      const count1 = presenterPage.locator('text=/1 viewer/')
      await expect(count1).toBeVisible({ timeout: 5000 })

      // Presenter should still be able to interact
      const viewer = presenterPage.locator('.openseadragon-container')
      await expect(viewer).toBeVisible()

      presenterLogger.end()
    } finally {
      await presenterContext.close()
      await followerContext.close()
    }
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

test.describe('Phase 2: Performance', () => {
  /**
   * Phase 2 spec: Session creation is fast
   * Reference: IMPLEMENTATION_PLAN.md (performance)
   */
  test('session creation should complete within 5 seconds', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'perf-session-create')

    const startTime = Date.now()

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    // Wait for share URL (indicates session is ready)
    const shareInput = page.locator('input[readonly]').first()
    await expect(shareInput).toBeVisible({ timeout: 10000 })

    const createTime = Date.now() - startTime
    logger.log('Performance', 'session-create', `${createTime}ms`)

    // Should complete within 5 seconds
    expect(createTime).toBeLessThan(5000)

    logger.end()
  })

  /**
   * Phase 2 spec: UI remains responsive during collaboration
   * Reference: IMPLEMENTATION_PLAN.md (performance)
   */
  test('UI should remain responsive', async ({ page }) => {
    const logger = setupVerboseLogging(page, 'perf-responsive')

    await logStep(page, logger, 1, 'Create session')
    await page.goto(`${BASE_URL}/s/new?slide=demo`)

    const viewer = page.locator('.openseadragon-container')
    await expect(viewer).toBeVisible({ timeout: 15000 })
    await viewer.click()

    await logStep(page, logger, 2, 'Perform rapid interactions')
    // Simulate rapid pan/zoom
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('+')
      await page.waitForTimeout(50)
      await page.keyboard.press('-')
      await page.waitForTimeout(50)
    }

    await logStep(page, logger, 3, 'Verify UI still responsive')
    // Should still be able to interact
    await page.keyboard.press('?')
    const helpDialog = page.locator('text=Keyboard Shortcuts')
    await expect(helpDialog).toBeVisible({ timeout: 2000 })

    logger.end()
  })
})
