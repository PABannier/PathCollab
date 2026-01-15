/**
 * Verbose Logging Utilities for E2E Tests
 *
 * Provides detailed logging of all browser activity, network requests,
 * WebSocket messages, and test steps. All timestamps in ISO format.
 *
 * User Preference: Verbose - log every HTTP/WS request, response, timing
 */

import type { Page, BrowserContext, WebSocket as PlaywrightWebSocket } from '@playwright/test'

export interface LogEntry {
  timestamp: string
  category: string
  type: string
  message: string
  data?: unknown
}

/**
 * Test logger that captures all events with timestamps
 */
export class TestLogger {
  private logs: LogEntry[] = []
  private testName: string

  constructor(testName: string) {
    this.testName = testName
    this.log('Test', 'start', `Test started: ${testName}`)
  }

  log(category: string, type: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      type,
      message,
      data,
    }
    this.logs.push(entry)
    console.log(`[${entry.timestamp}] [${category}:${type}] ${message}`)
    if (data) {
      console.log(`[${entry.timestamp}] [${category}:data] ${JSON.stringify(data).substring(0, 500)}`)
    }
  }

  step(stepNumber: number, description: string): void {
    this.log('Test', 'step', `Step ${stepNumber}: ${description}`)
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  end(): void {
    this.log('Test', 'end', `Test finished: ${this.testName}`)
  }
}

/**
 * Setup verbose logging for a Playwright page
 * Captures: console, requests, responses, WebSocket frames, errors
 */
export function setupVerboseLogging(page: Page, testName: string): TestLogger {
  const logger = new TestLogger(testName)

  // Browser console messages
  page.on('console', (msg) => {
    logger.log('Browser', msg.type(), msg.text())
  })

  // Network requests
  page.on('request', (req) => {
    const postData = req.postData()
    logger.log('Network', 'request', `${req.method()} ${req.url()}`, postData ? { body: postData.substring(0, 500) } : undefined)
  })

  // Network responses
  page.on('response', (res) => {
    const timing = res.timing()
    const duration = timing?.responseEnd ? Math.round(timing.responseEnd) : 0
    logger.log('Network', 'response', `${res.status()} ${res.url()} (${duration}ms)`)
  })

  // Request failures
  page.on('requestfailed', (req) => {
    logger.log('Network', 'failed', `${req.method()} ${req.url()} - ${req.failure()?.errorText}`)
  })

  // WebSocket connections
  page.on('websocket', (ws: PlaywrightWebSocket) => {
    logger.log('WebSocket', 'connect', ws.url())

    ws.on('framesent', (frame) => {
      logger.log('WebSocket', 'sent', frame.payload.substring(0, 500))
    })

    ws.on('framereceived', (frame) => {
      logger.log('WebSocket', 'received', frame.payload.substring(0, 500))
    })

    ws.on('close', () => {
      logger.log('WebSocket', 'close', ws.url())
    })

    ws.on('socketerror', (error) => {
      logger.log('WebSocket', 'error', error)
    })
  })

  // Page errors
  page.on('pageerror', (err) => {
    logger.log('Page', 'error', err.message, { stack: err.stack })
  })

  // Page crashes
  page.on('crash', () => {
    logger.log('Page', 'crash', 'Page crashed!')
  })

  // Dialog events (alerts, confirms, prompts)
  page.on('dialog', (dialog) => {
    logger.log('Page', 'dialog', `${dialog.type()}: ${dialog.message()}`)
  })

  // Download events
  page.on('download', (download) => {
    logger.log('Page', 'download', download.suggestedFilename())
  })

  return logger
}

/**
 * Setup logging for a browser context (all pages)
 */
export function setupContextLogging(context: BrowserContext, contextName: string): TestLogger {
  const logger = new TestLogger(`Context: ${contextName}`)

  context.on('page', (page) => {
    logger.log('Context', 'new-page', page.url())
    setupVerboseLogging(page, `${contextName}:${page.url()}`)
  })

  context.on('close', () => {
    logger.log('Context', 'close', contextName)
  })

  return logger
}

/**
 * Log a test step with screenshot capture
 */
export async function logStep(
  page: Page,
  logger: TestLogger,
  stepNumber: number,
  description: string,
  screenshotPath?: string
): Promise<void> {
  logger.step(stepNumber, description)

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: false })
    logger.log('Test', 'screenshot', `Saved to ${screenshotPath}`)
  }
}

/**
 * Measure and log performance of an action
 */
export async function measureAction<T>(
  logger: TestLogger,
  actionName: string,
  action: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now()
  logger.log('Performance', 'start', `Starting: ${actionName}`)

  const result = await action()

  const durationMs = Math.round(performance.now() - start)
  logger.log('Performance', 'end', `Completed: ${actionName} (${durationMs}ms)`)

  return { result, durationMs }
}

/**
 * Assert with logging
 */
export function loggedAssert(
  logger: TestLogger,
  condition: boolean,
  requirement: string,
  actual: unknown,
  expected: unknown
): void {
  if (condition) {
    logger.log('Assert', 'pass', `PASS: ${requirement}`)
  } else {
    logger.log('Assert', 'fail', `FAIL: ${requirement}`, { expected, actual })
  }
}

/**
 * Format a summary of WebSocket messages for logging
 */
export function formatWsMessages(messages: unknown[]): string {
  return messages
    .map((msg, i) => `  [${i}] ${JSON.stringify(msg).substring(0, 100)}`)
    .join('\n')
}
