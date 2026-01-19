export interface KeyboardShortcutsHintProps {
  /** Callback when hint is clicked to show help */
  onClick: () => void
}

/**
 * Small hint button in the corner showing keyboard shortcuts are available.
 */
export function KeyboardShortcutsHint({ onClick }: KeyboardShortcutsHintProps) {
  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 right-4 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      title="Keyboard shortcuts (press ? for help)"
      aria-label="Show keyboard shortcuts help"
    >
      Press <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">?</kbd> for shortcuts
    </button>
  )
}
