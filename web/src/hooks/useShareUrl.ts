import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionState } from './useSession'

/** Session secrets for secure sharing */
export interface SessionSecrets {
  joinSecret: string
  presenterKey: string
}

/** Slide info for creating share links */
export interface ShareableSlide {
  id: string
}

export interface UseShareUrlOptions {
  /** Current session state (null if no session exists) */
  session: SessionState | null
  /** Session secrets containing joinSecret for share URL */
  secrets: SessionSecrets | null
  /** Current slide info (needed for auto-creating session) */
  slide: ShareableSlide | null
  /** Function to create a new session when user clicks share without existing session */
  createSession: (slideId: string) => void
}

export interface UseShareUrlReturn {
  /** The generated share URL (null if no session) */
  shareUrl: string | null
  /** Copy button state for UI feedback */
  copyState: 'idle' | 'success' | 'error'
  /** Handler for the share button - creates session if needed, copies URL to clipboard */
  handleShare: () => Promise<void>
}

/**
 * Hook for managing share URL generation and clipboard operations.
 *
 * Handles:
 * - Building share URL with join secret in hash fragment (never sent to server)
 * - Auto-creating session when user clicks share without existing session
 * - Auto-copying URL to clipboard after session creation
 * - Copy button state management with feedback timing
 */
export function useShareUrl({
  session,
  secrets,
  slide,
  createSession,
}: UseShareUrlOptions): UseShareUrlReturn {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle')

  // Track pending copy request (for auto-copy after session creation)
  const pendingCopyRef = useRef(false)

  // Build share URL when session is created with secrets
  useEffect(() => {
    if (session && secrets) {
      // Build share URL with join secret in hash (not sent to server)
      const baseUrl = `${window.location.origin}/s/${session.id}#join=${secrets.joinSecret}`
      setShareUrl(baseUrl)
    }
  }, [session, secrets])

  // Handle share link - auto-creates session if needed
  const handleShare = useCallback(async () => {
    if (copyState === 'success') return // Prevent rapid double-clicks

    // If no session, auto-create one and mark pending copy
    if (!session && slide) {
      pendingCopyRef.current = true
      createSession(slide.id)
      return
    }

    const url = shareUrl || window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('success')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 3000)
    }
  }, [shareUrl, session, slide, copyState, createSession])

  // Auto-copy share URL when session is created after Copy Link click
  useEffect(() => {
    if (!pendingCopyRef.current || !shareUrl) return
    pendingCopyRef.current = false

    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopyState('success')
        setTimeout(() => setCopyState('idle'), 2000)
      })
      .catch(() => {
        setCopyState('error')
        setTimeout(() => setCopyState('idle'), 3000)
      })
  }, [shareUrl])

  return {
    shareUrl,
    copyState,
    handleShare,
  }
}
