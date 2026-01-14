interface ToggleProps {
  /** Whether the toggle is checked */
  checked: boolean
  /** Called when the toggle state changes */
  onChange: (checked: boolean) => void
  /** Accessible label for the toggle */
  'aria-label': string
  /** Whether the toggle is disabled */
  disabled?: boolean
  /** Size variant */
  size?: 'sm' | 'md'
}

/**
 * A toggle switch component for boolean settings.
 * Styled for dark theme with smooth animation.
 */
export function Toggle({
  checked,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  size = 'md',
}: ToggleProps) {
  const sizes = {
    sm: {
      track: 'w-8 h-4',
      thumb: 'w-3 h-3',
      translate: 'translate-x-4',
    },
    md: {
      track: 'w-11 h-6',
      thumb: 'w-5 h-5',
      translate: 'translate-x-5',
    },
  }

  const s = sizes[size]

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex flex-shrink-0 cursor-pointer rounded-full
        transition-colors duration-200 ease-in-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800
        ${s.track}
        ${checked ? 'bg-blue-500' : 'bg-gray-600'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block rounded-full bg-white shadow-lg
          transform transition-transform duration-200 ease-in-out
          ${s.thumb}
          ${checked ? s.translate : 'translate-x-0.5'}
          ${size === 'sm' ? 'mt-0.5' : 'mt-0.5'}
        `}
      />
    </button>
  )
}
