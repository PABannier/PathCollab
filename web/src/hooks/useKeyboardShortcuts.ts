import { useEffect, useCallback, useState } from 'react'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  description: string
  action: () => void
}

export interface UseKeyboardShortcutsOptions {
  shortcuts: KeyboardShortcut[]
  enabled?: boolean
}

/**
 * Hook for managing keyboard shortcuts.
 * Returns state for showing/hiding the shortcuts help modal.
 */
export function useKeyboardShortcuts({ shortcuts, enabled = true }: UseKeyboardShortcutsOptions) {
  const [showHelp, setShowHelp] = useState(false)

  const handleKeydown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Escape in input fields to close help
        if (e.key === 'Escape' && showHelp) {
          setShowHelp(false)
          return
        }
        return
      }

      const ctrl = e.metaKey || e.ctrlKey
      const shift = e.shiftKey
      const alt = e.altKey

      // Check for ? to show help (Shift + /)
      if (e.key === '?' || (shift && e.key === '/')) {
        e.preventDefault()
        setShowHelp((prev) => !prev)
        return
      }

      // Check for Escape to close help
      if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false)
          return
        }
      }

      // Check registered shortcuts
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? ctrl : !ctrl
        const shiftMatch = shortcut.shift ? shift : !shift
        const altMatch = shortcut.alt ? alt : !alt
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          shortcut.action()
          return
        }
      }
    },
    [enabled, shortcuts, showHelp]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [handleKeydown])

  return {
    showHelp,
    setShowHelp,
  }
}

/**
 * Format a shortcut for display (e.g., "Ctrl+L" or "⌘L" on Mac)
 */
export function formatShortcut(
  shortcut: Pick<KeyboardShortcut, 'key' | 'ctrl' | 'shift' | 'alt'>
): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const parts: string[] = []

  if (shortcut.ctrl) {
    parts.push(isMac ? '⌘' : 'Ctrl')
  }
  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt')
  }
  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift')
  }

  // Format special keys
  let key = shortcut.key
  if (key === '\\') key = '\\'
  if (key === 'Escape') key = 'Esc'
  if (key === ' ') key = 'Space'

  parts.push(key.toUpperCase())

  return isMac ? parts.join('') : parts.join('+')
}
