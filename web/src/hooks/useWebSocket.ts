import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'solo'

export interface WebSocketMessage {
  type: string
  [key: string]: unknown
}

interface UseWebSocketOptions {
  url: string
  /** When false, disables connection (e.g., for solo mode). Defaults to true. */
  enabled?: boolean
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  onMessage?: (message: WebSocketMessage) => void
}

interface UseWebSocketReturn {
  status: ConnectionStatus
  sendMessage: (message: WebSocketMessage) => number
  lastMessage: WebSocketMessage | null
  reconnect: () => void
  disconnect: () => void
  latency: number | null
}

const DEFAULT_RECONNECT_INTERVAL = 1000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10

export function useWebSocket({
  url,
  enabled = true,
  reconnect: shouldReconnect = true,
  reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  onOpen,
  onClose,
  onError,
  onMessage,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>(enabled ? 'disconnected' : 'solo')
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [latency, setLatency] = useState<number | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const pingTimestampsRef = useRef<Map<number, number>>(new Map())
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageQueueRef = useRef<WebSocketMessage[]>([])
  const seqRef = useRef(0)

  // Store callbacks and config in refs to avoid stale closures and circular deps
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)
  const onMessageRef = useRef(onMessage)
  const configRef = useRef({
    url,
    enabled,
    shouldReconnect,
    reconnectInterval,
    maxReconnectAttempts,
  })
  // Ref for the connect function to break circular dependency
  const connectFnRef = useRef<() => void>(() => {})

  // Update refs when values change
  useEffect(() => {
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onErrorRef.current = onError
    onMessageRef.current = onMessage
    configRef.current = { url, enabled, shouldReconnect, reconnectInterval, maxReconnectAttempts }
  }, [
    onOpen,
    onClose,
    onError,
    onMessage,
    url,
    enabled,
    shouldReconnect,
    reconnectInterval,
    maxReconnectAttempts,
  ])

  // Clear reconnect timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  // Internal connect function
  const doConnect = useCallback(() => {
    const { url, enabled, shouldReconnect, reconnectInterval, maxReconnectAttempts } =
      configRef.current

    // Don't connect if disabled (solo mode)
    if (!enabled) {
      return
    }

    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    clearReconnectTimeout()
    setStatus('connecting')

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        reconnectAttemptsRef.current = 0

        // Send queued messages
        while (messageQueueRef.current.length > 0) {
          const msg = messageQueueRef.current.shift()
          if (msg) {
            ws.send(JSON.stringify(msg))
          }
        }

        onOpenRef.current?.()
      }

      ws.onclose = () => {
        setStatus('disconnected')
        setLatency(null)
        pingTimestampsRef.current.clear()
        onCloseRef.current?.()

        // Schedule reconnection
        if (shouldReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = reconnectInterval * Math.pow(2, reconnectAttemptsRef.current)
          setStatus('reconnecting')
          reconnectAttemptsRef.current++

          reconnectTimeoutRef.current = setTimeout(
            () => {
              connectFnRef.current()
            },
            Math.min(delay, 30000)
          ) // Cap at 30 seconds
        }
      }

      ws.onerror = (event) => {
        onErrorRef.current?.(event)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage

          // Handle ack responses for latency measurement (server sends ack with ack_seq after ping)
          if (message.type === 'ack' && typeof message.ack_seq === 'number') {
            const sentTime = pingTimestampsRef.current.get(message.ack_seq)
            if (sentTime) {
              setLatency(Date.now() - sentTime)
              pingTimestampsRef.current.delete(message.ack_seq)
            }
          }

          setLastMessage(message)
          onMessageRef.current?.(message)
        } catch {
          console.error('Failed to parse WebSocket message:', event.data)
        }
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      setStatus('disconnected')
    }
  }, [clearReconnectTimeout])

  // Update the connect function ref
  useEffect(() => {
    connectFnRef.current = doConnect
  }, [doConnect])

  // Send message
  const sendMessage = useCallback((message: WebSocketMessage): number => {
    // Add sequence number if not present
    const seq = (typeof message.seq === 'number' ? message.seq : seqRef.current++) as number
    const msgWithSeq = {
      ...message,
      seq,
    }

    if (!configRef.current.enabled) {
      return seq
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msgWithSeq))
    } else {
      // Queue message for when connection is established
      messageQueueRef.current.push(msgWithSeq)
    }

    return seq
  }, [])

  // Periodic ping for latency measurement
  useEffect(() => {
    if (status !== 'connected') {
      return
    }

    const sendPing = () => {
      const seq = seqRef.current++
      const msgWithSeq = { type: 'ping', seq }
      pingTimestampsRef.current.set(seq, Date.now())
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msgWithSeq))
      }
    }

    // Send immediately on connect, then every 5 seconds
    sendPing()
    const interval = setInterval(sendPing, 5000)
    return () => clearInterval(interval)
  }, [status])

  // Manually reconnect
  const manualReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0
    doConnect()
  }, [doConnect])

  // Disconnect
  const disconnect = useCallback(() => {
    clearReconnectTimeout()
    reconnectAttemptsRef.current = maxReconnectAttempts // Prevent auto-reconnect

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Clear message queue to prevent stale messages being sent on reconnect
    messageQueueRef.current = []

    setStatus('disconnected')
  }, [clearReconnectTimeout, maxReconnectAttempts])

  // Connect on mount and when url changes
  useEffect(() => {
    // Defer connection to avoid synchronous setState in effect
    const timeoutId = setTimeout(() => {
      doConnect()
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      clearReconnectTimeout()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      // Clear message queue on unmount to prevent memory leaks
      messageQueueRef.current = []
    }
  }, [doConnect, clearReconnectTimeout])

  return {
    status,
    sendMessage,
    lastMessage,
    reconnect: manualReconnect,
    disconnect,
    latency,
  }
}
