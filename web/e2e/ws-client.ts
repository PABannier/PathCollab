/**
 * WebSocket Test Client for E2E Integration Tests
 *
 * Provides a programmatic WebSocket client for testing the PathCollab
 * WebSocket protocol against a real server. Tests verify against
 * IMPLEMENTATION_PLAN.md specifications.
 *
 * Phase 1 Protocol Messages:
 * - create_session: Creates new session with slide_id
 * - join_session: Joins existing session with session_id and join_secret
 * - ping/pong: Keepalive messages
 * - session_created: Response with SessionSnapshot
 * - session_joined: Response with SessionSnapshot and participant info
 * - ack: Acknowledgment with seq number
 * - session_error: Error with code and message
 */

import WebSocket from 'ws'

// Message types from IMPLEMENTATION_PLAN.md Phase 1
export interface ClientMessage {
  type: string
  seq: number
  [key: string]: unknown
}

export interface ServerMessage {
  type: string
  [key: string]: unknown
}

export interface SessionSnapshot {
  id: string
  rev: number
  slide: SlideInfo
  presenter: Participant
  followers: Participant[]
  layer_visibility: LayerVisibility
  presenter_viewport: Viewport
}

export interface SlideInfo {
  id: string
  name: string
  width: number
  height: number
  tile_size: number
  num_levels: number
  tile_url_template: string
}

export interface Participant {
  id: string
  name: string
  color: string
  role: 'presenter' | 'follower'
  connected_at: number
}

export interface Viewport {
  center_x: number
  center_y: number
  zoom: number
  timestamp: number
}

export interface LayerVisibility {
  tissue_heatmap_visible: boolean
  tissue_heatmap_opacity: number
  tissue_classes_visible: number[]
  cell_polygons_visible: boolean
  cell_polygons_opacity: number
  cell_classes_visible: number[]
  cell_hover_enabled: boolean
}

export interface SessionCreatedResponse {
  type: 'session_created'
  session: SessionSnapshot
  join_secret: string
  presenter_key: string
}

export interface SessionJoinedResponse {
  type: 'session_joined'
  session: SessionSnapshot
  you: Participant
}

export interface SessionErrorResponse {
  type: 'session_error'
  code: string
  message: string
}

export interface AckResponse {
  type: 'ack'
  ack_seq: number
  status: 'ok' | 'rejected'
  reason?: string
}

/**
 * Test WebSocket client for integration testing
 */
export class TestWebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private seq: number = 0
  private receivedMessages: ServerMessage[] = []
  private pendingResponses: Map<
    number,
    { resolve: (msg: ServerMessage) => void; reject: (err: Error) => void }
  > = new Map()
  private onMessageCallback?: (msg: ServerMessage) => void
  private connected: boolean = false

  constructor(url: string) {
    this.url = url
  }

  /**
   * Connect to the WebSocket server
   * Phase 1 spec: WebSocket upgrade on same connection as HTTP
   */
  async connect(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timestamp = () => new Date().toISOString()
      console.log(`[${timestamp()}] [WsClient] Connecting to ${this.url}`)

      this.ws = new WebSocket(this.url)

      const timeoutId = setTimeout(() => {
        reject(new Error(`WebSocket connection timeout after ${timeout}ms`))
        this.ws?.close()
      }, timeout)

      this.ws.on('open', () => {
        clearTimeout(timeoutId)
        this.connected = true
        console.log(`[${timestamp()}] [WsClient] Connected`)
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage
          console.log(`[${timestamp()}] [WsClient:recv] ${JSON.stringify(msg).substring(0, 300)}`)
          this.receivedMessages.push(msg)

          // Handle ack responses
          if (msg.type === 'ack' && typeof (msg as AckResponse).ack_seq === 'number') {
            const pending = this.pendingResponses.get((msg as AckResponse).ack_seq)
            if (pending) {
              pending.resolve(msg)
              this.pendingResponses.delete((msg as AckResponse).ack_seq)
            }
          }

          // Handle session_created/session_joined which also acknowledge the request
          if (msg.type === 'session_created' || msg.type === 'session_joined') {
            // These are responses to the last sent message
            const lastSeq = this.seq - 1
            const pending = this.pendingResponses.get(lastSeq)
            if (pending) {
              pending.resolve(msg)
              this.pendingResponses.delete(lastSeq)
            }
          }

          this.onMessageCallback?.(msg)
        } catch {
          console.log(
            `[${timestamp()}] [WsClient:error] Failed to parse message: ${data.toString()}`
          )
        }
      })

      this.ws.on('error', (err) => {
        console.log(`[${timestamp()}] [WsClient:error] ${err.message}`)
        reject(err)
      })

      this.ws.on('close', (code, reason) => {
        this.connected = false
        console.log(`[${timestamp()}] [WsClient] Closed: ${code} ${reason.toString()}`)
      })
    })
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.connected = false
    }
  }

  /**
   * Send a message and wait for acknowledgment
   */
  async send(message: Omit<ClientMessage, 'seq'>, timeout = 5000): Promise<ServerMessage> {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket not connected')
    }

    const seq = this.seq++
    const fullMessage: ClientMessage = { ...message, seq }

    const timestamp = () => new Date().toISOString()
    console.log(`[${timestamp()}] [WsClient:send] ${JSON.stringify(fullMessage).substring(0, 300)}`)

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingResponses.delete(seq)
        reject(new Error(`Response timeout after ${timeout}ms for seq ${seq}`))
      }, timeout)

      this.pendingResponses.set(seq, {
        resolve: (msg) => {
          clearTimeout(timeoutId)
          resolve(msg)
        },
        reject: (err) => {
          clearTimeout(timeoutId)
          reject(err)
        },
      })

      this.ws!.send(JSON.stringify(fullMessage))
    })
  }

  /**
   * Send a message without waiting for response
   */
  sendNoWait(message: Omit<ClientMessage, 'seq'>): void {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket not connected')
    }

    const seq = this.seq++
    const fullMessage: ClientMessage = { ...message, seq }

    const timestamp = () => new Date().toISOString()
    console.log(`[${timestamp()}] [WsClient:send] ${JSON.stringify(fullMessage).substring(0, 300)}`)

    this.ws.send(JSON.stringify(fullMessage))
  }

  /**
   * Create a new session
   * Phase 1 spec: create_session returns session_created with SessionSnapshot
   */
  async createSession(slideId: string): Promise<SessionCreatedResponse> {
    const response = await this.send({
      type: 'create_session',
      slide_id: slideId,
    })

    if (response.type !== 'session_created') {
      throw new Error(`Expected session_created, got ${response.type}: ${JSON.stringify(response)}`)
    }

    return response as SessionCreatedResponse
  }

  /**
   * Join an existing session
   * Phase 1 spec: join_session returns session_joined with SessionSnapshot and participant
   */
  async joinSession(sessionId: string, joinSecret: string): Promise<SessionJoinedResponse> {
    const response = await this.send({
      type: 'join_session',
      session_id: sessionId,
      join_secret: joinSecret,
    })

    if (response.type !== 'session_joined') {
      throw new Error(`Expected session_joined, got ${response.type}: ${JSON.stringify(response)}`)
    }

    return response as SessionJoinedResponse
  }

  /**
   * Send ping message
   * Phase 1 spec: ping/pong keepalive
   */
  async ping(): Promise<ServerMessage> {
    return this.send({ type: 'ping' })
  }

  /**
   * Update cursor position
   */
  async updateCursor(x: number, y: number): Promise<ServerMessage> {
    return this.send({
      type: 'cursor_update',
      x,
      y,
    })
  }

  /**
   * Update viewport
   */
  async updateViewport(centerX: number, centerY: number, zoom: number): Promise<ServerMessage> {
    return this.send({
      type: 'viewport_update',
      center_x: centerX,
      center_y: centerY,
      zoom,
    })
  }

  /**
   * Get all received messages
   */
  getReceivedMessages(): ServerMessage[] {
    return [...this.receivedMessages]
  }

  /**
   * Get messages of a specific type
   */
  getMessagesByType(type: string): ServerMessage[] {
    return this.receivedMessages.filter((m) => m.type === type)
  }

  /**
   * Wait for a message of a specific type
   */
  async waitForMessage(type: string, timeout = 5000): Promise<ServerMessage> {
    const existing = this.receivedMessages.find((m) => m.type === type)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for message type: ${type}`))
      }, timeout)

      const originalCallback = this.onMessageCallback
      this.onMessageCallback = (msg) => {
        originalCallback?.(msg)
        if (msg.type === type) {
          clearTimeout(timeoutId)
          this.onMessageCallback = originalCallback
          resolve(msg)
        }
      }
    })
  }

  /**
   * Set a callback for all messages
   */
  onMessage(callback: (msg: ServerMessage) => void): void {
    this.onMessageCallback = callback
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Clear received messages
   */
  clearMessages(): void {
    this.receivedMessages = []
  }
}
