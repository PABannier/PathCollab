import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export interface WebSocketMessage {
  type: string
  [key: string]: unknown
}

interface UseWebSocketOptions {
  url: string
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
}

const DEFAULT_RECONNECT_INTERVAL = 1000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10

export function useWebSocket({
  url,
  reconnect: shouldReconnect = true,
  reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  onOpen,
  onClose,
  onError,
  onMessage,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
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
    configRef.current = { url, shouldReconnect, reconnectInterval, maxReconnectAttempts }
  }, [
    onOpen,
    onClose,
    onError,
    onMessage,
    url,
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
    const { url, shouldReconnect, reconnectInterval, maxReconnectAttempts } = configRef.current

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
  const sendMessage = useCallback((message: WebSocketMessage) => {
    // Add sequence number if not present
    const seq = message.seq ?? seqRef.current++
    const msgWithSeq = {
      ...message,
      seq,
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msgWithSeq))
    } else {
      // Queue message for when connection is established
      messageQueueRef.current.push(msgWithSeq)
    }

    return seq
  }, [])

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
    }
  }, [doConnect, clearReconnectTimeout])

  return {
    status,
    sendMessage,
    lastMessage,
    reconnect: manualReconnect,
    disconnect,
  }
}
