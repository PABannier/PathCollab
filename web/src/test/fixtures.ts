/**
 * Test Fixtures
 *
 * Reusable test data for consistent testing across all test files.
 * All fixtures produce valid data that passes runtime validation.
 */

// ============================================================================
// Type Imports
// ============================================================================

import type { SessionState, Participant, Viewport } from '../hooks/useSession'

// ============================================================================
// Participant Fixtures
// ============================================================================

export const mockPresenter: Participant = {
  id: 'presenter-001',
  name: 'Swift Falcon',
  color: '#3B82F6',
  role: 'presenter',
  connected_at: Date.now() - 60000,
}

export const mockFollower1: Participant = {
  id: 'follower-001',
  name: 'Calm Otter',
  color: '#EF4444',
  role: 'follower',
  connected_at: Date.now() - 30000,
}

export const mockFollower2: Participant = {
  id: 'follower-002',
  name: 'Bright Panda',
  color: '#10B981',
  role: 'follower',
  connected_at: Date.now() - 15000,
}

export function createMockParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: `participant-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test User',
    color: '#3B82F6',
    role: 'follower',
    connected_at: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// Viewport Fixtures
// ============================================================================

export const mockViewport: Viewport = {
  center_x: 0.5,
  center_y: 0.5,
  zoom: 1.0,
  timestamp: Date.now(),
}

export function createMockViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    center_x: 0.5,
    center_y: 0.5,
    zoom: 1.0,
    timestamp: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// Slide Fixtures
// ============================================================================

export interface SlideInfo {
  id: string
  name: string
  width: number
  height: number
  tile_size: number
  num_levels: number
  tile_url_template: string
}

export const mockSlide: SlideInfo = {
  id: 'demo-slide-001',
  name: 'Test Slide',
  width: 100000,
  height: 100000,
  tile_size: 256,
  num_levels: 10,
  tile_url_template: '/api/slide/demo-slide-001/tile/{level}/{x}/{y}',
}

export function createMockSlide(overrides: Partial<SlideInfo> = {}): SlideInfo {
  const id = overrides.id || `slide-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    name: 'Test Slide',
    width: 100000,
    height: 100000,
    tile_size: 256,
    num_levels: 10,
    tile_url_template: `/api/slide/${id}/tile/{level}/{x}/{y}`,
    ...overrides,
  }
}

// ============================================================================
// Session Fixtures
// ============================================================================

export const mockSession: SessionState = {
  id: 'k3m9p2qdx7',
  rev: 1,
  slide: mockSlide,
  presenter: mockPresenter,
  followers: [mockFollower1, mockFollower2],
  presenter_viewport: mockViewport,
}

export function createMockSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: `${Math.random().toString(36).slice(2, 12)}`,
    rev: 1,
    slide: createMockSlide(),
    presenter: createMockParticipant({ role: 'presenter' }),
    followers: [],
    presenter_viewport: createMockViewport(),
    ...overrides,
  }
}

// ============================================================================
// Cursor Fixtures
// ============================================================================

export interface CursorWithParticipant {
  participant_id: string
  name: string
  color: string
  is_presenter: boolean
  x: number
  y: number
}

export const mockCursors: CursorWithParticipant[] = [
  {
    participant_id: mockPresenter.id,
    name: mockPresenter.name,
    color: mockPresenter.color,
    is_presenter: true,
    x: 50000,
    y: 50000,
  },
  {
    participant_id: mockFollower1.id,
    name: mockFollower1.name,
    color: mockFollower1.color,
    is_presenter: false,
    x: 30000,
    y: 40000,
  },
]

export function createMockCursor(
  overrides: Partial<CursorWithParticipant> = {}
): CursorWithParticipant {
  return {
    participant_id: `cursor-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test User',
    color: '#3B82F6',
    is_presenter: false,
    x: Math.random() * 100000,
    y: Math.random() * 100000,
    ...overrides,
  }
}

// ============================================================================
// DOMRect Fixtures
// ============================================================================

export const mockViewerBounds: DOMRect = {
  x: 0,
  y: 60,
  width: 1200,
  height: 800,
  top: 60,
  right: 1200,
  bottom: 860,
  left: 0,
  toJSON: () => ({}),
}

export function createMockDOMRect(overrides: Partial<DOMRect> = {}): DOMRect {
  const rect = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    right: 800,
    bottom: 600,
    left: 0,
    ...overrides,
  }
  return {
    ...rect,
    toJSON: () => rect,
  } as DOMRect
}

// ============================================================================
// WebSocket Message Fixtures
// ============================================================================

export const mockSessionCreatedMessage = {
  type: 'session_created' as const,
  session: mockSession,
  join_secret: 'test-join-secret-128bit',
  presenter_key: 'test-presenter-key-192bit',
}

export const mockSessionJoinedMessage = {
  type: 'session_joined' as const,
  session: mockSession,
  you: mockFollower1,
}

export const mockPresenceDeltaMessage = {
  type: 'presence_delta' as const,
  changed: mockCursors,
  removed: [] as string[],
  server_ts: Date.now(),
}

export const mockPresenterViewportMessage = {
  type: 'presenter_viewport' as const,
  viewport: mockViewport,
}
