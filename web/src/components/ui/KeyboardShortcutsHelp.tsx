import { useEffect, useRef } from 'react'
import { formatShortcut } from '../../hooks/useKeyboardShortcuts'
import { Button } from './Button'

interface ShortcutItem {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  description: string
}

interface KeyboardShortcutsHelpProps {
  shortcuts: ShortcutItem[]
  onClose: () => void
}

/**
 * Modal showing available keyboard shortcuts.
 */
export function KeyboardShortcutsHelp({ shortcuts, onClose }: KeyboardShortcutsHelpProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap and close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 'var(--z-modal)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        ref={modalRef}
        className="rounded-lg max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--panel-bg)',
          border: '1px solid var(--panel-border)',
          boxShadow: 'var(--shadow-dark-lg)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

        {/* Shortcuts list */}
        <div className="p-4">
          <table className="w-full">
            <tbody>
              {shortcuts.map((shortcut, index) => (
                <tr key={index} className="border-b border-gray-700 last:border-b-0">
                  <td className="py-2 pr-4">
                    <kbd
                      className="px-2 py-1 text-xs font-mono rounded"
                      style={{
                        backgroundColor: 'var(--color-gray-700)',
                        border: '1px solid var(--color-gray-600)',
                        color: 'var(--color-gray-200)',
                      }}
                    >
                      {formatShortcut(shortcut)}
                    </kbd>
                  </td>
                  <td className="py-2 text-sm text-gray-300">{shortcut.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 text-center">
          <span className="text-xs text-gray-500">
            Press <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-700 rounded">?</kbd> to
            toggle this help
          </span>
        </div>
      </div>
    </div>
  )
}
