/**
 * Server Harness for E2E Tests
 *
 * Spawns a real pathcollab-server process for integration testing.
 *
 * Phase 1 Requirements Tested:
 * - Server runs on port 8080 (configurable)
 * - WebSocket upgrade on same connection as HTTP
 * - Health endpoint returns status
 */

import { spawn, type ChildProcess } from 'child_process'

export interface ServerHarnessOptions {
  port?: number
  slidesDir?: string
  logLevel?: string
  timeout?: number
}

export class ServerHarness {
  private server: ChildProcess | null = null
  private port: number
  private slidesDir: string
  private logLevel: string
  private timeout: number
  private logs: string[] = []

  constructor(options: ServerHarnessOptions = {}) {
    this.port = options.port ?? 8080
    this.slidesDir = options.slidesDir ?? '/data/wsi-slides'
    this.logLevel = options.logLevel ?? 'info'
    this.timeout = options.timeout ?? 30000
  }

  /**
   * Start the pathcollab-server process
   * Phase 1 spec: Server should run on port 8080 (configurable)
   */
  async start(): Promise<void> {
    const timestamp = () => new Date().toISOString()
    console.log(`[${timestamp()}] [Server] Starting pathcollab-server on port ${this.port}`)
    console.log(`[${timestamp()}] [Server] Slides directory: ${this.slidesDir}`)

    this.server = spawn('cargo', ['run', '--release'], {
      cwd: '/data/projects/PathCollab/server',
      env: {
        ...process.env,
        PORT: String(this.port),
        SLIDES_DIR: this.slidesDir,
        RUST_LOG: this.logLevel,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Capture stdout
    this.server.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      this.logs.push(`[stdout] ${line}`)
      console.log(`[${timestamp()}] [Server:stdout] ${line}`)
    })

    // Capture stderr
    this.server.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      this.logs.push(`[stderr] ${line}`)
      console.log(`[${timestamp()}] [Server:stderr] ${line}`)
    })

    // Handle process exit
    this.server.on('exit', (code, signal) => {
      console.log(`[${timestamp()}] [Server] Process exited with code ${code}, signal ${signal}`)
      this.server = null
    })

    this.server.on('error', (err) => {
      console.log(`[${timestamp()}] [Server:error] ${err.message}`)
    })

    // Wait for server to be ready
    await this.waitForHealth()
    console.log(`[${timestamp()}] [Server] Ready and accepting connections`)
  }

  /**
   * Stop the server process
   */
  async stop(): Promise<void> {
    const timestamp = () => new Date().toISOString()

    if (this.server) {
      console.log(`[${timestamp()}] [Server] Stopping server (SIGTERM)`)
      this.server.kill('SIGTERM')

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.server) {
            console.log(`[${timestamp()}] [Server] Force killing (SIGKILL)`)
            this.server.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        if (this.server) {
          this.server.on('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })

      this.server = null
      console.log(`[${timestamp()}] [Server] Stopped`)
    }
  }

  /**
   * Wait for health endpoint to respond
   * Phase 1 spec: GET /health returns {"status": "ok", "version": "..."}
   */
  private async waitForHealth(): Promise<void> {
    const timestamp = () => new Date().toISOString()
    const url = `http://localhost:${this.port}/health`
    const start = Date.now()

    console.log(`[${timestamp()}] [Server] Waiting for health check at ${url}`)

    while (Date.now() - start < this.timeout) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          console.log(`[${timestamp()}] [Server] Health check passed: ${JSON.stringify(data)}`)

          // Verify response matches Phase 1 spec
          if (data.status !== 'ok') {
            console.log(
              `[${timestamp()}] [Server] WARNING: status is "${data.status}", expected "ok"`
            )
          }
          if (!data.version) {
            console.log(`[${timestamp()}] [Server] WARNING: version field missing`)
          }

          return
        }
        console.log(`[${timestamp()}] [Server] Health check returned ${res.status}`)
      } catch {
        // Server not ready yet, continue waiting
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    throw new Error(`Server failed to start within ${this.timeout}ms timeout`)
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port
  }

  /**
   * Get the base URL for HTTP requests
   */
  getHttpUrl(): string {
    return `http://localhost:${this.port}`
  }

  /**
   * Get the base URL for WebSocket connections
   * Phase 1 spec: WebSocket upgrade on same connection as HTTP
   */
  getWsUrl(): string {
    return `ws://localhost:${this.port}/ws`
  }

  /**
   * Get all captured logs
   */
  getLogs(): string[] {
    return [...this.logs]
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null
  }
}

/**
 * Create a server harness with default test configuration
 */
export function createTestServerHarness(port = 8080): ServerHarness {
  return new ServerHarness({
    port,
    slidesDir: '/data/wsi-slides',
    logLevel: 'debug',
    timeout: 30000,
  })
}
