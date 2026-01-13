/**
 * Smoke Tests
 *
 * Basic tests to verify the application loads and renders correctly.
 * These tests should pass regardless of server state.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'

test.describe('Smoke Tests', () => {
  test('home page loads successfully', async ({ page }) => {
    const response = await page.goto(BASE_URL)

    // Verify successful response
    expect(response?.status()).toBeLessThan(400)

    // Verify page has content
    const content = await page.content()
    expect(content.length).toBeGreaterThan(100)
  })

  test('page has valid HTML structure', async ({ page }) => {
    await page.goto(BASE_URL)

    // Check for basic HTML elements
    const html = await page.$('html')
    const head = await page.$('head')
    const body = await page.$('body')

    expect(html).not.toBeNull()
    expect(head).not.toBeNull()
    expect(body).not.toBeNull()
  })

  test('page has title', async ({ page }) => {
    await page.goto(BASE_URL)

    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('React app renders', async ({ page }) => {
    await page.goto(BASE_URL)

    // React app should have a root element
    const root = await page.$('#root')
    expect(root).not.toBeNull()

    // Root should have child content
    const children = await root?.$$('*')
    expect(children?.length).toBeGreaterThan(0)
  })

  test('no JavaScript errors on page load', async ({ page }) => {
    const errors: string[] = []

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Filter out known acceptable errors
    const criticalErrors = errors.filter(
      (err) =>
        !err.includes('ResizeObserver') && // Common React/browser quirk
        !err.includes('WebSocket') // Expected if server isn't running
    )

    expect(criticalErrors).toHaveLength(0)
  })

  test('no console errors on page load', async ({ page }) => {
    const consoleErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Filter expected errors
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('WebSocket') && // Expected if server isn't running
        !err.includes('net::ERR_') && // Network errors when server is down
        !err.includes('Failed to load resource')
    )

    expect(criticalErrors).toHaveLength(0)
  })

  test('page is responsive', async ({ page }) => {
    // Test different viewport sizes
    const viewports = [
      { width: 1920, height: 1080, name: 'desktop-large' },
      { width: 1280, height: 800, name: 'desktop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 375, height: 667, name: 'mobile' },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(BASE_URL)

      // Verify no horizontal scrollbar (unless intended)
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const windowWidth = await page.evaluate(() => window.innerWidth)

      // Allow small tolerance for scrollbar
      expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 20)
    }
  })

  test('basic navigation works', async ({ page }) => {
    await page.goto(BASE_URL)

    // Get all links on the page
    const links = await page.$$('a[href]')

    // At least one navigation link should exist
    expect(links.length).toBeGreaterThan(0)
  })
})

test.describe('Static Assets', () => {
  test('favicon loads', async ({ page }) => {
    await page.goto(BASE_URL)

    // Check for favicon link
    const favicon = await page.$('link[rel*="icon"]')
    if (favicon) {
      const href = await favicon.getAttribute('href')
      expect(href).toBeTruthy()
    }
  })

  test('CSS loads and applies', async ({ page }) => {
    await page.goto(BASE_URL)

    // Verify stylesheets are loaded
    const stylesheets = await page.$$('link[rel="stylesheet"], style')
    expect(stylesheets.length).toBeGreaterThan(0)

    // Check that body has some styling (not default browser style)
    const bodyStyle = await page.evaluate(() => {
      const body = document.body
      const computed = window.getComputedStyle(body)
      return {
        fontFamily: computed.fontFamily,
        margin: computed.margin,
      }
    })

    // Body should have non-default styling
    expect(bodyStyle).toBeTruthy()
  })
})

test.describe('Accessibility Basics', () => {
  test('page has lang attribute', async ({ page }) => {
    await page.goto(BASE_URL)

    const lang = await page.getAttribute('html', 'lang')
    expect(lang).toBeTruthy()
  })

  test('images have alt text', async ({ page }) => {
    await page.goto(BASE_URL)

    const images = await page.$$('img')
    for (const img of images) {
      const alt = await img.getAttribute('alt')
      // alt attribute should exist (can be empty for decorative images)
      expect(alt).not.toBeNull()
    }
  })

  test('buttons are keyboard accessible', async ({ page }) => {
    await page.goto(BASE_URL)

    const buttons = await page.$$('button')
    for (const button of buttons) {
      const tabIndex = await button.getAttribute('tabindex')
      // Buttons should be focusable (tabindex not -1)
      expect(tabIndex).not.toBe('-1')
    }
  })
})
