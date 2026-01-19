import { useMemo } from 'react'
import type { KeyboardShortcut } from '../../hooks/useKeyboardShortcuts'

export interface UseSessionKeyboardShortcutsOptions {
  /** Handler for zoom reset (Ctrl+0) */
  handleZoomReset: () => void
  /** Handler for snap to presenter (Ctrl+F) */
  handleSnapToPresenter: () => void
  /** Handler for copy share link (Ctrl+L) */
  handleShare: () => void
  /** Setter for help dialog visibility */
  setShowHelp: (show: boolean) => void
}

export interface UseSessionKeyboardShortcutsReturn {
  /** Configured keyboard shortcuts for the session */
  shortcuts: KeyboardShortcut[]
}

/**
 * Hook for configuring keyboard shortcuts used in the session page.
 *
 * Shortcuts:
 * - Ctrl+0: Reset zoom to fit
 * - Ctrl+F: Follow presenter (snap to presenter view)
 * - Ctrl+L: Copy share link
 * - Escape: Close panels
 */
export function useSessionKeyboardShortcuts({
  handleZoomReset,
  handleSnapToPresenter,
  handleShare,
  setShowHelp,
}: UseSessionKeyboardShortcutsOptions): UseSessionKeyboardShortcutsReturn {
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        key: '0',
        ctrl: true,
        description: 'Reset zoom to fit',
        action: handleZoomReset,
      },
      {
        key: 'f',
        ctrl: true,
        description: 'Follow presenter',
        action: handleSnapToPresenter,
      },
      {
        key: 'l',
        ctrl: true,
        description: 'Copy share link',
        action: handleShare,
      },
      {
        key: 'Escape',
        description: 'Close panels',
        action: () => setShowHelp(false),
      },
    ],
    [handleZoomReset, handleSnapToPresenter, handleShare, setShowHelp]
  )

  return { shortcuts }
}
