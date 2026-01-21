import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket, type ConnectionStatus, type WebSocketMessage } from './useWebSocket'

/** Solo mode flag - when true, skips WebSocket/session entirely for standalone viewer */
const SOLO_MODE = import.meta.env.VITE_SOLO_MODE === 'true'

export interface Participant {
  id: string
  name: string
  color: string
  role: 'presenter' | 'follower'
  connected_at: number
}

/** Viewport as received from the server (snake_case) */
interface ServerViewport {
  center_x: number
  center_y: number
  zoom: number
  timestamp: number
}

/** Frontend viewport type (camelCase) */
export interface Viewport {
  centerX: number
  centerY: number
  zoom: number
  timestamp: number
}

/** Convert server viewport to frontend viewport */
function toFrontendViewport(sv: ServerViewport): Viewport {
  return {
    centerX: sv.center_x,
    centerY: sv.center_y,
    zoom: sv.zoom,
    timestamp: sv.timestamp,
  }
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

/** Cell overlay state as received from server (snake_case) */
interface ServerCellOverlayState {
  enabled: boolean
  opacity: number
  visible_cell_types: string[]
}

/** Tissue overlay state as received from server (snake_case) */
interface ServerTissueOverlayState {
  enabled: boolean
  opacity: number
  visible_tissue_types: number[]
}

/** Frontend cell overlay state (camelCase) */
export interface CellOverlayState {
  enabled: boolean
  opacity: number
  visibleCellTypes: string[]
}

/** Frontend tissue overlay state (camelCase) */
export interface TissueOverlayState {
  enabled: boolean
  opacity: number
  visibleTissueTypes: number[]
}

/** Convert server cell overlay state to frontend cell overlay state */
function toFrontendCellOverlay(sc: ServerCellOverlayState): CellOverlayState {
  return {
    enabled: sc.enabled,
    opacity: sc.opacity,
    visibleCellTypes: sc.visible_cell_types,
  }
}

/** Convert server tissue overlay state to frontend tissue overlay state */
function toFrontendTissueOverlay(sc: ServerTissueOverlayState): TissueOverlayState {
  return {
    enabled: sc.enabled,
    opacity: sc.opacity,
    visibleTissueTypes: sc.visible_tissue_types,
  }
}

/** Session state as received from server (snake_case viewport) */
interface ServerSessionState {
  id: string
  rev: number
  slide: SlideInfo
  presenter: Participant
  followers: Participant[]
  presenter_viewport: ServerViewport
}

export interface SessionState {
  id: string
  rev: number
  slide: SlideInfo
  presenter: Participant
  followers: Participant[]
  presenterViewport: Viewport
}

/** Convert server session state to frontend session state */
function toFrontendSession(ss: ServerSessionState): SessionState {
  return {
    id: ss.id,
    rev: ss.rev,
    slide: ss.slide,
    presenter: ss.presenter,
    followers: ss.followers,
    presenterViewport: toFrontendViewport(ss.presenter_viewport),
  }
}

interface CursorWithParticipant {
  participant_id: string
  name: string
  color: string
  is_presenter: boolean
  x: number
  y: number
}

interface UseSessionOptions {
  sessionId?: string
  joinSecret?: string
  presenterKey?: string
  onError?: (message: string) => void
  onSessionCreated?: (sessionId: string, joinSecret: string, presenterKey: string) => void
}

interface SessionSecrets {
  joinSecret: string
  presenterKey: string
}

interface UseSessionReturn {
  session: SessionState | null
  currentUser: Participant | null
  isPresenter: boolean
  isCreatingSession: boolean
  connectionStatus: ConnectionStatus
  latency: number | null
  cursors: CursorWithParticipant[]
  presenterViewport: Viewport | null
  secrets: SessionSecrets | null
  isFollowing: boolean
  hasDiverged: boolean
  presenterCellOverlay: CellOverlayState | null
  presenterTissueOverlay: TissueOverlayState | null

  // Actions
  createSession: (slideId: string) => void
  joinSession: () => void
  authenticatePresenter: () => void
  updateCursor: (x: number, y: number) => void
  updateViewport: (centerX: number, centerY: number, zoom: number) => void
  changeSlide: (slideId: string) => void
  snapToPresenter: () => void
  setIsFollowing: (following: boolean) => void
  checkDivergence: (currentViewport: { centerX: number; centerY: number; zoom: number }) => void
  updateCellOverlay: (enabled: boolean, opacity: number, visibleCellTypes: string[]) => void
  updateTissueOverlay: (enabled: boolean, opacity: number, visibleTissueTypes: number[]) => void
}

export function useSession({
  sessionId,
  joinSecret,
  presenterKey,
  onError,
  onSessionCreated,
}: UseSessionOptions): UseSessionReturn {
  // All hooks must be called unconditionally to satisfy React's rules of hooks
  const [session, setSession] = useState<SessionState | null>(null)
  const [currentUser, setCurrentUser] = useState<Participant | null>(null)
  const [isPresenter, setIsPresenter] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [cursors, setCursors] = useState<CursorWithParticipant[]>([])
  const [presenterViewport, setPresenterViewport] = useState<Viewport | null>(null)
  const [secrets, setSecrets] = useState<SessionSecrets | null>(null)
  const [isFollowing, setIsFollowing] = useState(true) // Default to following when joining
  const [hasDiverged, setHasDiverged] = useState(false)
  const [presenterCellOverlay, setPresenterCellOverlay] = useState<CellOverlayState | null>(null)
  const [presenterTissueOverlay, setPresenterTissueOverlay] = useState<TissueOverlayState | null>(
    null
  )
  const pendingPresenterAuthSeqRef = useRef<number | null>(null)
  const presenterAuthSessionRef = useRef<string | null>(null)
  const sendMessageRef = useRef<((message: WebSocketMessage) => number) | null>(null)

  // Build WebSocket URL
  // In development, connect directly to backend on port 8080 (Vite+Bun proxy has WebSocket issues)
  // Use same hostname as page to support remote access (e.g., localhost or server IP)
  // In production, use same origin (nginx/load balancer handles proxying)
  const wsUrl = import.meta.env.DEV
    ? `ws://${window.location.hostname}:8080/ws`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'session_created': {
          const serverSession = message.session as ServerSessionState & {
            cell_overlay?: ServerCellOverlayState
            tissue_overlay?: ServerTissueOverlayState
          }
          const sessionData = toFrontendSession(serverSession)
          setSession(sessionData)
          setIsCreatingSession(false)
          // When session is created, we're the presenter
          setCurrentUser(sessionData.presenter)
          setIsPresenter(true)
          setPresenterViewport(sessionData.presenterViewport)
          // Extract initial cell overlay state if present
          if (serverSession.cell_overlay) {
            setPresenterCellOverlay(toFrontendCellOverlay(serverSession.cell_overlay))
          }
          // Extract initial tissue overlay state if present
          if (serverSession.tissue_overlay) {
            setPresenterTissueOverlay(toFrontendTissueOverlay(serverSession.tissue_overlay))
          }
          // Save secrets for sharing
          if (message.join_secret && message.presenter_key) {
            setSecrets({
              joinSecret: message.join_secret as string,
              presenterKey: message.presenter_key as string,
            })
            // Notify caller about session creation for URL update
            onSessionCreated?.(
              sessionData.id,
              message.join_secret as string,
              message.presenter_key as string
            )
          }
          break
        }
        case 'session_joined': {
          const serverSession = message.session as ServerSessionState & {
            cell_overlay?: ServerCellOverlayState
            tissue_overlay?: ServerTissueOverlayState
          }
          const sessionData = toFrontendSession(serverSession)
          setSession(sessionData)
          if (message.you) {
            setCurrentUser(message.you as Participant)
            setIsPresenter((message.you as Participant).role === 'presenter')
          }
          setPresenterViewport(sessionData.presenterViewport)
          // Extract initial cell overlay state if present
          if (serverSession.cell_overlay) {
            setPresenterCellOverlay(toFrontendCellOverlay(serverSession.cell_overlay))
          }
          // Extract initial tissue overlay state if present
          if (serverSession.tissue_overlay) {
            setPresenterTissueOverlay(toFrontendTissueOverlay(serverSession.tissue_overlay))
          }
          break
        }

        case 'participant_joined': {
          const participant = message.participant as Participant
          setSession((prev) => {
            if (!prev) return prev
            if (prev.presenter.id === participant.id) {
              return prev
            }
            if (prev.followers.some((f) => f.id === participant.id)) {
              return prev
            }
            return {
              ...prev,
              followers: [...prev.followers, participant],
            }
          })
          break
        }

        case 'participant_left': {
          const participantId = message.participant_id as string
          setSession((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              followers: prev.followers.filter((p) => p.id !== participantId),
            }
          })
          setCursors((prev) => prev.filter((c) => c.participant_id !== participantId))
          break
        }

        case 'presence_delta': {
          const changed = (message.changed || []) as CursorWithParticipant[]
          const removed = (message.removed || []) as string[]

          setCursors((prev) => {
            // Use a Map for O(1) lookups instead of O(n) findIndex in a loop
            const cursorMap = new Map(prev.map((c) => [c.participant_id, c]))

            // Remove cursors for removed participants
            for (const id of removed) {
              cursorMap.delete(id)
            }

            // Update or add changed cursors
            for (const cursor of changed) {
              cursorMap.set(cursor.participant_id, cursor)
            }

            return Array.from(cursorMap.values())
          })
          break
        }

        case 'presenter_viewport': {
          const serverViewport = message.viewport as ServerViewport
          setPresenterViewport(toFrontendViewport(serverViewport))
          break
        }

        case 'presenter_cell_overlay': {
          const cellOverlay: ServerCellOverlayState = {
            enabled: message.enabled as boolean,
            opacity: message.opacity as number,
            visible_cell_types: message.visible_cell_types as string[],
          }
          setPresenterCellOverlay(toFrontendCellOverlay(cellOverlay))
          break
        }

        case 'presenter_tissue_overlay': {
          const tissueOverlay: ServerTissueOverlayState = {
            enabled: message.enabled as boolean,
            opacity: message.opacity as number,
            visible_tissue_types: message.visible_tissue_types as number[],
          }
          setPresenterTissueOverlay(toFrontendTissueOverlay(tissueOverlay))
          break
        }

        case 'session_error': {
          setIsCreatingSession(false)
          onError?.(message.message as string)
          break
        }

        case 'session_ended': {
          setSession(null)
          setCurrentUser(null)
          setIsPresenter(false)
          setCursors([])
          setPresenterViewport(null)
          setPresenterCellOverlay(null)
          setPresenterTissueOverlay(null)
          presenterAuthSessionRef.current = null
          pendingPresenterAuthSeqRef.current = null
          onError?.(`Session ended: ${message.reason}`)
          break
        }

        case 'ack': {
          const ackSeq = message.ack_seq as number | undefined
          if (ackSeq !== undefined && pendingPresenterAuthSeqRef.current === ackSeq) {
            pendingPresenterAuthSeqRef.current = null
            if (message.status === 'rejected') {
              setIsPresenter(false)
              // Only fire onError for presenter auth rejections we're tracking
              onError?.(message.reason as string)
            } else {
              setIsPresenter(true)
            }
          }
          break
        }

        case 'slide_changed': {
          const newSlide = message.slide as SlideInfo
          setSession((prev) => {
            if (!prev) return prev
            return { ...prev, slide: newSlide }
          })
          break
        }

        case 'ping': {
          sendMessageRef.current?.({ type: 'ping' })
          break
        }

        case 'pong': {
          break
        }
      }
    },
    [onError, onSessionCreated]
  )

  const { status, sendMessage, latency } = useWebSocket({
    url: wsUrl,
    enabled: !SOLO_MODE,
    onMessage: handleMessage,
  })

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // Auto-join session on connection if sessionId and joinSecret are provided
  useEffect(() => {
    if (status === 'connected' && sessionId && joinSecret && !session) {
      sendMessage({
        type: 'join_session',
        session_id: sessionId,
        join_secret: joinSecret,
      })
    }
  }, [status, sessionId, joinSecret, session, sendMessage])

  // Create session action
  const createSession = useCallback(
    (slideId: string) => {
      setIsCreatingSession(true)
      sendMessage({
        type: 'create_session',
        slide_id: slideId,
      })
    },
    [sendMessage]
  )

  // Join session action
  const joinSession = useCallback(() => {
    if (sessionId && joinSecret) {
      sendMessage({
        type: 'join_session',
        session_id: sessionId,
        join_secret: joinSecret,
      })
    }
  }, [sessionId, joinSecret, sendMessage])

  // Authenticate as presenter
  const authenticatePresenter = useCallback(() => {
    if (presenterKey) {
      const seq = sendMessage({
        type: 'presenter_auth',
        presenter_key: presenterKey,
      })
      pendingPresenterAuthSeqRef.current = seq
    }
  }, [presenterKey, sendMessage])

  // Auto-authenticate presenter when a presenter key is provided
  useEffect(() => {
    if (!session || !presenterKey || status !== 'connected' || isPresenter) return

    if (presenterAuthSessionRef.current === session.id) return
    presenterAuthSessionRef.current = session.id
    authenticatePresenter()
  }, [authenticatePresenter, isPresenter, presenterKey, session, status])

  // Update cursor position
  const updateCursor = useCallback(
    (x: number, y: number) => {
      sendMessage({
        type: 'cursor_update',
        x,
        y,
      })
    },
    [sendMessage]
  )

  // Update viewport
  const updateViewport = useCallback(
    (centerX: number, centerY: number, zoom: number) => {
      sendMessage({
        type: 'viewport_update',
        center_x: centerX,
        center_y: centerY,
        zoom,
      })
    },
    [sendMessage]
  )

  // Change slide (presenter only)
  const changeSlide = useCallback(
    (slideId: string) => {
      sendMessage({
        type: 'change_slide',
        slide_id: slideId,
      })
    },
    [sendMessage]
  )

  // Snap to presenter
  const snapToPresenter = useCallback(() => {
    sendMessage({
      type: 'snap_to_presenter',
    })
  }, [sendMessage])

  // Update cell overlay state (presenter only, broadcast to followers)
  const updateCellOverlay = useCallback(
    (enabled: boolean, opacity: number, visibleCellTypes: string[]) => {
      sendMessage({
        type: 'cell_overlay_update',
        enabled,
        opacity,
        visible_cell_types: visibleCellTypes,
      })
    },
    [sendMessage]
  )

  // Update tissue overlay state (presenter only, broadcast to followers)
  const updateTissueOverlay = useCallback(
    (enabled: boolean, opacity: number, visibleTissueTypes: number[]) => {
      sendMessage({
        type: 'tissue_overlay_update',
        enabled,
        opacity,
        visible_tissue_types: visibleTissueTypes,
      })
    },
    [sendMessage]
  )

  // Check if follower's viewport has diverged from presenter's
  const checkDivergence = useCallback(
    (currentViewport: { centerX: number; centerY: number; zoom: number }) => {
      if (!presenterViewport || isPresenter || !isFollowing) {
        setHasDiverged(false)
        return
      }

      // Threshold-based comparison in normalized coordinates
      const positionDiff = Math.sqrt(
        Math.pow(currentViewport.centerX - presenterViewport.centerX, 2) +
          Math.pow(currentViewport.centerY - presenterViewport.centerY, 2)
      )
      const zoomRatio = currentViewport.zoom / presenterViewport.zoom
      const zoomDiff = Math.abs(Math.log(zoomRatio))

      const isDiverged = positionDiff > 0.05 || zoomDiff > 0.2

      if (isDiverged && isFollowing) {
        setIsFollowing(false)
        setHasDiverged(true)
      }
    },
    [presenterViewport, isPresenter, isFollowing]
  )

  // Wrapper to reset divergence when re-enabling follow
  const handleSetIsFollowing = useCallback((following: boolean) => {
    setIsFollowing(following)
    if (following) setHasDiverged(false)
  }, [])

  // In solo mode, override return values for standalone viewing
  // Hooks are still called above but we return solo-appropriate values
  if (SOLO_MODE) {
    return {
      session: null,
      currentUser: null,
      isPresenter: true, // Act as presenter in solo mode for full controls
      isCreatingSession: false,
      connectionStatus: status, // Will be 'solo' from useWebSocket
      latency: null,
      cursors: [],
      presenterViewport: null,
      secrets: null,
      isFollowing: false,
      hasDiverged: false,
      presenterCellOverlay: null,
      presenterTissueOverlay: null,
      createSession,
      joinSession,
      authenticatePresenter,
      updateCursor,
      updateViewport,
      changeSlide,
      snapToPresenter,
      setIsFollowing: handleSetIsFollowing,
      checkDivergence,
      updateCellOverlay,
      updateTissueOverlay,
    }
  }

  return {
    session,
    currentUser,
    isPresenter,
    isCreatingSession,
    connectionStatus: status,
    latency,
    cursors,
    presenterViewport,
    secrets,
    isFollowing,
    hasDiverged,
    presenterCellOverlay,
    presenterTissueOverlay,
    createSession,
    joinSession,
    authenticatePresenter,
    updateCursor,
    updateViewport,
    changeSlide,
    snapToPresenter,
    setIsFollowing: handleSetIsFollowing,
    checkDivergence,
    updateCellOverlay,
    updateTissueOverlay,
  }
}
