/**
 * Unit Tests for useSession Hook
 *
 * Tests the session management hook including:
 * - Session creation and joining
 * - Participant management
 * - Cursor and viewport updates
 * - Presenter authentication
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSession } from './useSession'
import { installMockWebSocket, type MockWebSocketInstance } from '../test/utils'
import {
  mockSession,
  mockFollower1,
  mockViewport,
  mockCursors,
  createMockSlide,
} from '../test/fixtures'

describe('useSession', () => {
  let mockWs: {
    getInstance: () => MockWebSocketInstance | null
    restore: () => void
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockWs = installMockWebSocket()
  })

  afterEach(() => {
    mockWs.restore()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should start with null session and user', () => {
      const { result } = renderHook(() => useSession({}))

      expect(result.current.session).toBeNull()
      expect(result.current.currentUser).toBeNull()
      expect(result.current.isPresenter).toBe(false)
      expect(result.current.cursors).toEqual([])
      expect(result.current.presenterViewport).toBeNull()
      expect(result.current.secrets).toBeNull()
    })

    it('should start with disconnected connection status', () => {
      const { result } = renderHook(() => useSession({}))

      expect(result.current.connectionStatus).toBe('disconnected')
    })
  })

  describe('session creation', () => {
    it('should create session and update state on session_created message', async () => {
      const { result } = renderHook(() => useSession({}))

      // Connect
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      // Create session
      act(() => {
        result.current.createSession('test-slide-001')
      })

      // Verify message was sent
      const sentMessages = mockWs.getInstance()?.getSentMessages()
      expect(sentMessages?.some((m) => m.type === 'create_session')).toBe(true)

      // Simulate server response
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'session_created',
          session: mockSession,
          join_secret: 'test-join-secret',
          presenter_key: 'test-presenter-key',
        })
      })

      expect(result.current.session).toEqual(mockSession)
      expect(result.current.currentUser).toEqual(mockSession.presenter)
      expect(result.current.isPresenter).toBe(true)
      expect(result.current.secrets).toEqual({
        joinSecret: 'test-join-secret',
        presenterKey: 'test-presenter-key',
      })
    })
  })

  describe('session joining', () => {
    it('should join session and update state on session_joined message', async () => {
      const { result } = renderHook(() =>
        useSession({
          sessionId: mockSession.id,
          joinSecret: 'test-join-secret',
        })
      )

      // Connect
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      // Simulate server response
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
      })

      expect(result.current.session).toEqual(mockSession)
      expect(result.current.currentUser).toEqual(mockFollower1)
      expect(result.current.isPresenter).toBe(false)
    })

    it('should auto-join when sessionId and joinSecret are provided', async () => {
      renderHook(() =>
        useSession({
          sessionId: mockSession.id,
          joinSecret: 'test-join-secret',
        })
      )

      // Connect
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      // Check that join message was sent
      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const joinMessage = sentMessages?.find((m) => m.type === 'join_session')
      expect(joinMessage).toBeDefined()
      expect(joinMessage?.session_id).toBe(mockSession.id)
      expect(joinMessage?.join_secret).toBe('test-join-secret')
    })
  })

  describe('participant management', () => {
    it('should add participant on participant_joined message', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup: Create session first
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_created',
          session: { ...mockSession, followers: [] },
          join_secret: 'test',
          presenter_key: 'test',
        })
      })

      expect(result.current.session?.followers).toHaveLength(0)

      // Add new participant
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'participant_joined',
          participant: mockFollower1,
        })
      })

      expect(result.current.session?.followers).toHaveLength(1)
      expect(result.current.session?.followers[0]).toEqual(mockFollower1)
    })

    it('should remove participant on participant_left message', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup: Join session with followers
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
      })

      expect(result.current.session?.followers.length).toBeGreaterThan(0)
      const initialFollowerCount = result.current.session?.followers.length ?? 0

      // Remove a follower
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'participant_left',
          participant_id: mockFollower1.id,
        })
      })

      expect(result.current.session?.followers.length).toBe(initialFollowerCount - 1)
    })
  })

  describe('cursor updates', () => {
    it('should update cursors on presence_delta message', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
      })

      // Receive cursor update
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'presence_delta',
          changed: mockCursors,
          removed: [],
          server_ts: Date.now(),
        })
      })

      expect(result.current.cursors).toEqual(mockCursors)
    })

    it('should remove cursors for removed participants', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup with cursors
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
        mockWs.getInstance()?.simulateMessage({
          type: 'presence_delta',
          changed: mockCursors,
          removed: [],
          server_ts: Date.now(),
        })
      })

      expect(result.current.cursors.length).toBe(mockCursors.length)

      // Remove a cursor
      const cursorToRemove = mockCursors[0].participant_id
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'presence_delta',
          changed: [],
          removed: [cursorToRemove],
          server_ts: Date.now(),
        })
      })

      expect(
        result.current.cursors.find((c) => c.participant_id === cursorToRemove)
      ).toBeUndefined()
    })

    it('should send cursor update when updateCursor is called', async () => {
      const { result } = renderHook(() => useSession({}))

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      act(() => {
        result.current.updateCursor(100, 200)
      })

      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const cursorMessage = sentMessages?.find((m) => m.type === 'cursor_update')
      expect(cursorMessage).toBeDefined()
      expect(cursorMessage?.x).toBe(100)
      expect(cursorMessage?.y).toBe(200)
    })
  })

  describe('viewport updates', () => {
    it('should update presenter viewport on presenter_viewport message', async () => {
      const { result } = renderHook(() => useSession({}))

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
      })

      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'presenter_viewport',
          viewport: mockViewport,
        })
      })

      expect(result.current.presenterViewport).toEqual(mockViewport)
    })

    it('should send viewport update when updateViewport is called', async () => {
      const { result } = renderHook(() => useSession({}))

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      act(() => {
        result.current.updateViewport(0.3, 0.4, 2.5)
      })

      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const viewportMessage = sentMessages?.find((m) => m.type === 'viewport_update')
      expect(viewportMessage).toBeDefined()
      expect(viewportMessage?.center_x).toBe(0.3)
      expect(viewportMessage?.center_y).toBe(0.4)
      expect(viewportMessage?.zoom).toBe(2.5)
    })

    it('should send snap_to_presenter when snapToPresenter is called', async () => {
      const { result } = renderHook(() => useSession({}))

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      act(() => {
        result.current.snapToPresenter()
      })

      const sentMessages = mockWs.getInstance()?.getSentMessages()
      expect(sentMessages?.some((m) => m.type === 'snap_to_presenter')).toBe(true)
    })
  })

  describe('presenter authentication', () => {
    it('should send presenter_auth when authenticatePresenter is called', async () => {
      const { result } = renderHook(() =>
        useSession({
          presenterKey: 'test-presenter-key',
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      act(() => {
        result.current.authenticatePresenter()
      })

      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const authMessage = sentMessages?.find((m) => m.type === 'presenter_auth')
      expect(authMessage).toBeDefined()
      expect(authMessage?.presenter_key).toBe('test-presenter-key')
    })

    it('should set isPresenter when presenter_auth ack succeeds', async () => {
      const { result } = renderHook(() =>
        useSession({
          presenterKey: 'test-presenter-key',
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      act(() => {
        result.current.authenticatePresenter()
      })

      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const authMessage = sentMessages?.find((m) => m.type === 'presenter_auth')

      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'ack',
          ack_seq: authMessage?.seq,
          status: 'ok',
        })
      })

      expect(result.current.isPresenter).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should call onError when session_error is received', async () => {
      const onError = vi.fn()

      renderHook(() =>
        useSession({
          onError,
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_error',
          code: 'session_not_found',
          message: 'Session not found',
        })
      })

      expect(onError).toHaveBeenCalledWith('Session not found')
    })

    it('should call onError when presenter auth ack is rejected', async () => {
      const onError = vi.fn()

      const { result } = renderHook(() =>
        useSession({
          presenterKey: 'test-presenter-key',
          onError,
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      // Trigger presenter auth
      act(() => {
        result.current.authenticatePresenter()
      })

      // Get the sequence number from the sent message
      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const authMessage = sentMessages?.find((m) => m.type === 'presenter_auth')

      // Simulate rejection with matching seq
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'ack',
          ack_seq: authMessage?.seq,
          status: 'rejected',
          reason: 'Invalid presenter key',
        })
      })

      expect(onError).toHaveBeenCalledWith('Invalid presenter key')
    })

    it('should reset state when session_ended is received', async () => {
      const onError = vi.fn()
      const { result } = renderHook(() =>
        useSession({
          onError,
        })
      )

      // Setup: Create session
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_created',
          session: mockSession,
          join_secret: 'test',
          presenter_key: 'test',
        })
      })

      expect(result.current.session).not.toBeNull()

      // End session
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'session_ended',
          reason: 'presenter_left',
        })
      })

      expect(result.current.session).toBeNull()
      expect(result.current.currentUser).toBeNull()
      expect(result.current.isPresenter).toBe(false)
      expect(result.current.cursors).toEqual([])
      expect(result.current.presenterViewport).toBeNull()
      expect(onError).toHaveBeenCalled()
    })
  })

  // Overlay loading tests removed - overlay functionality to be reimplemented

  describe('slide change', () => {
    it('should update session slide when slide_changed message is received', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup: Join a session
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: mockSession,
          you: mockFollower1,
        })
      })

      // Verify initial slide
      expect(result.current.session?.slide.id).toBe(mockSession.slide.id)
      expect(result.current.session?.slide.name).toBe(mockSession.slide.name)

      // Create a new slide to switch to
      const newSlide = createMockSlide({
        id: 'new-slide-001',
        name: 'New Slide from Presenter',
        width: 200000,
        height: 150000,
      })

      // Simulate presenter changing the slide
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'slide_changed',
          slide: newSlide,
        })
      })

      // Verify slide was updated
      expect(result.current.session?.slide.id).toBe('new-slide-001')
      expect(result.current.session?.slide.name).toBe('New Slide from Presenter')
      expect(result.current.session?.slide.width).toBe(200000)
      expect(result.current.session?.slide.height).toBe(150000)
    })

    it('should send change_slide message when changeSlide is called', async () => {
      const { result } = renderHook(() => useSession({}))

      // Connect
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      // Call changeSlide
      act(() => {
        result.current.changeSlide('new-slide-002')
      })

      // Verify message was sent
      const sentMessages = mockWs.getInstance()?.getSentMessages()
      const changeSlideMessage = sentMessages?.find((m) => m.type === 'change_slide')
      expect(changeSlideMessage).toBeDefined()
      expect(changeSlideMessage?.slide_id).toBe('new-slide-002')
    })

    it('should preserve other session state when slide changes', async () => {
      const { result } = renderHook(() => useSession({}))

      // Setup: Join session with specific state
      const sessionWithFollowers = {
        ...mockSession,
        followers: [mockFollower1],
        rev: 5,
      }

      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
        mockWs.getInstance()?.simulateMessage({
          type: 'session_joined',
          session: sessionWithFollowers,
          you: mockFollower1,
        })
      })

      // Verify initial state
      expect(result.current.session?.followers).toHaveLength(1)
      expect(result.current.session?.presenter.id).toBe(mockSession.presenter.id)

      // Change slide
      const newSlide = createMockSlide({ id: 'changed-slide' })
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'slide_changed',
          slide: newSlide,
        })
      })

      // Verify other state is preserved
      expect(result.current.session?.slide.id).toBe('changed-slide')
      expect(result.current.session?.followers).toHaveLength(1)
      expect(result.current.session?.presenter.id).toBe(mockSession.presenter.id)
      expect(result.current.session?.id).toBe(mockSession.id)
    })

    it('should not update state if no session exists when slide_changed is received', async () => {
      const { result } = renderHook(() => useSession({}))

      // Connect but don't join session
      await act(async () => {
        vi.advanceTimersByTime(10)
        mockWs.getInstance()?.simulateOpen()
      })

      expect(result.current.session).toBeNull()

      // Simulate slide_changed without an active session
      const newSlide = createMockSlide({ id: 'orphan-slide' })
      await act(async () => {
        mockWs.getInstance()?.simulateMessage({
          type: 'slide_changed',
          slide: newSlide,
        })
      })

      // Session should still be null
      expect(result.current.session).toBeNull()
    })
  })
})
