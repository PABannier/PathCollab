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

export interface SlideInfo {
  id: string
  name: string
  width: number
  height: number
  tile_size: number
  num_levels: number
  tile_url_template: string
}

export interface SessionState {
  id: string
  rev: number
  slide: SlideInfo
  presenter: Participant
  followers: Participant[]
  layer_visibility: LayerVisibility
  presenter_viewport: Viewport
}

interface CursorWithParticipant {
  participant_id: string
  name: string
  color: string
  is_presenter: boolean
  x: number
  y: number
}

export interface OverlayManifest {
  overlay_id: string
  content_sha256: string
  raster_base_url: string
  vec_base_url: string
  tile_size: number
  levels: number
}

interface UseSessionOptions {
  sessionId?: string
  joinSecret?: string
  presenterKey?: string
  onError?: (message: string) => void
  onOverlayLoaded?: (overlayId: string, manifest: OverlayManifest) => void
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
  cursors: CursorWithParticipant[]
  presenterViewport: Viewport | null
  secrets: SessionSecrets | null

  // Actions
  createSession: (slideId: string) => void
  joinSession: () => void
  authenticatePresenter: () => void
  updateCursor: (x: number, y: number) => void
  updateViewport: (centerX: number, centerY: number, zoom: number) => void
  updateLayerVisibility: (visibility: LayerVisibility) => void
  snapToPresenter: () => void
}

// Stub functions for solo mode (must be defined outside hook to avoid recreating on each render)
const noopVoid = () => {}
const noopString = (_slideId: string) => {}
const noopXY = (_x: number, _y: number) => {}
const noopXYZ = (_centerX: number, _centerY: number, _zoom: number) => {}
const noopVisibility = (_visibility: LayerVisibility) => {}

export function useSession({
  sessionId,
  joinSecret,
  presenterKey,
  onError,
  onOverlayLoaded,
}: UseSessionOptions): UseSessionReturn {
  // In solo mode, return stubs immediately - no WebSocket, no session
  if (SOLO_MODE) {
    return {
      session: null,
      currentUser: null,
      isPresenter: true, // Act as presenter in solo mode for full controls
      isCreatingSession: false,
      connectionStatus: 'solo',
      cursors: [],
      presenterViewport: null,
      secrets: null,
      createSession: noopString,
      joinSession: noopVoid,
      authenticatePresenter: noopVoid,
      updateCursor: noopXY,
      updateViewport: noopXYZ,
      updateLayerVisibility: noopVisibility,
      snapToPresenter: noopVoid,
    }
  }

  const [session, setSession] = useState<SessionState | null>(null)
  const [currentUser, setCurrentUser] = useState<Participant | null>(null)
  const [isPresenter, setIsPresenter] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [cursors, setCursors] = useState<CursorWithParticipant[]>([])
  const [presenterViewport, setPresenterViewport] = useState<Viewport | null>(null)
  const [secrets, setSecrets] = useState<SessionSecrets | null>(null)
  const pendingPresenterAuthSeqRef = useRef<number | null>(null)
  const presenterAuthSessionRef = useRef<string | null>(null)

  // Build WebSocket URL
  // In development mode, connect directly to backend since Vite+Bun proxy has issues with WebSocket
  const wsUrl = import.meta.env.DEV
    ? 'ws://localhost:8080/ws'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'session_created': {
          const sessionData = message.session as SessionState
          setSession(sessionData)
          setIsCreatingSession(false)
          // When session is created, we're the presenter
          setCurrentUser(sessionData.presenter)
          setIsPresenter(true)
          setPresenterViewport(sessionData.presenter_viewport)
          // Save secrets for sharing
          if (message.join_secret && message.presenter_key) {
            setSecrets({
              joinSecret: message.join_secret as string,
              presenterKey: message.presenter_key as string,
            })
          }
          break
        }
        case 'session_joined': {
          const sessionData = message.session as SessionState
          setSession(sessionData)
          if (message.you) {
            setCurrentUser(message.you as Participant)
            setIsPresenter((message.you as Participant).role === 'presenter')
          }
          setPresenterViewport(sessionData.presenter_viewport)
          break
        }

        case 'participant_joined': {
          const participant = message.participant as Participant
          setSession((prev) => {
            if (!prev) return prev
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
            // Remove cursors for removed participants
            let next = prev.filter((c) => !removed.includes(c.participant_id))
            // Update or add changed cursors
            for (const cursor of changed) {
              const idx = next.findIndex((c) => c.participant_id === cursor.participant_id)
              if (idx >= 0) {
                // Create new array to avoid mutation
                next = [...next.slice(0, idx), cursor, ...next.slice(idx + 1)]
              } else {
                next = [...next, cursor]
              }
            }
            return next
          })
          break
        }

        case 'presenter_viewport': {
          const viewport = message.viewport as Viewport
          setPresenterViewport(viewport)
          break
        }

        case 'layer_state': {
          const visibility = message.visibility as LayerVisibility
          setSession((prev) => {
            if (!prev) return prev
            return { ...prev, layer_visibility: visibility }
          })
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
            } else {
              setIsPresenter(true)
            }
          }
          if (message.status === 'rejected') {
            onError?.(message.reason as string)
          }
          break
        }

        case 'overlay_loaded': {
          const overlayId = message.overlay_id as string
          const manifest = message.manifest as OverlayManifest
          onOverlayLoaded?.(overlayId, manifest)
          break
        }
      }
    },
    [onError, onOverlayLoaded]
  )

  const { status, sendMessage } = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
  })

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

  // Update layer visibility
  const updateLayerVisibility = useCallback(
    (visibility: LayerVisibility) => {
      sendMessage({
        type: 'layer_update',
        visibility,
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

  return {
    session,
    currentUser,
    isPresenter,
    isCreatingSession,
    connectionStatus: status,
    cursors,
    presenterViewport,
    secrets,
    createSession,
    joinSession,
    authenticatePresenter,
    updateCursor,
    updateViewport,
    updateLayerVisibility,
    snapToPresenter,
  }
}
