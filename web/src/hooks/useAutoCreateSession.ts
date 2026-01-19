import { useEffect, useMemo, useRef } from 'react'
import type { ConnectionStatus } from './useWebSocket'
import type { SessionState } from './useSession'

export interface UseAutoCreateSessionOptions {
  /** Current session ID from URL params */
  sessionId: string | undefined
  /** Join secret from URL hash (indicates joining existing session) */
  joinSecret: string | undefined
  /** Slide ID from URL search params */
  slideParam: string | undefined
  /** Default slide ID from API */
  defaultSlideId: string | undefined
  /** Current session state */
  session: SessionState | null
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus
  /** Function to create a new session */
  createSession: (slideId: string) => void
}

export interface UseAutoCreateSessionReturn {
  /** The slide ID to auto-create session with (null if not applicable) */
  autoCreateSlideId: string | null
  /** Whether we're waiting for a session to be created */
  isWaitingForSession: boolean
}

/**
 * Hook for handling automatic session creation on page load.
 *
 * Auto-creates a session when:
 * - URL is /s/new (not joining an existing session)
 * - WebSocket is connected
 * - No session exists yet
 * - A slide ID is available
 *
 * This makes collaboration seamless - users arrive and can immediately share.
 */
export function useAutoCreateSession({
  sessionId,
  joinSecret,
  slideParam,
  defaultSlideId,
  session,
  connectionStatus,
  createSession,
}: UseAutoCreateSessionOptions): UseAutoCreateSessionReturn {
  const autoCreateRequestedRef = useRef(false)

  // Determine the slide ID for auto-creation
  const autoCreateSlideId = useMemo(() => {
    // Don't auto-create if joining an existing session
    if (joinSecret) return null

    if (sessionId === 'new') {
      return slideParam || null
    }
    return null
  }, [joinSecret, sessionId, slideParam])

  // Auto-create session when connected and slide is available
  useEffect(() => {
    // Don't auto-create if we're joining an existing session
    if (sessionId && sessionId !== 'new') return
    // Don't create if already have a session or not connected
    if (session || connectionStatus !== 'connected') return
    // Don't create twice
    if (autoCreateRequestedRef.current) return
    // Need a slide to create session
    const slideId = autoCreateSlideId || slideParam || defaultSlideId
    if (!slideId) return

    autoCreateRequestedRef.current = true
    createSession(slideId)
  }, [
    autoCreateSlideId,
    connectionStatus,
    createSession,
    session,
    sessionId,
    slideParam,
    defaultSlideId,
  ])

  // Determine if we're waiting for a session to be created
  // If autoCreateSlideId is set and session is not created yet, we should wait
  // In solo mode, we never wait for session (there is no session)
  const isWaitingForSession = connectionStatus !== 'solo' && !!autoCreateSlideId && !session

  return {
    autoCreateSlideId,
    isWaitingForSession,
  }
}
