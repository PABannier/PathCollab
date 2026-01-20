import { Toggle } from './Toggle'

interface CellOverlayToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
  hasOverlay: boolean
  cellCount?: number
}

export function CellOverlayToggle({
  enabled,
  onChange,
  hasOverlay,
  cellCount,
}: CellOverlayToggleProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${hasOverlay ? 'text-gray-300' : 'text-gray-500'}`}>
          Cell Overlays
        </span>
        {enabled && hasOverlay && cellCount !== undefined && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 text-xs font-semibold rounded"
            style={{
              backgroundColor: 'var(--color-primary, #3b82f6)',
              color: 'white',
            }}
          >
            {cellCount.toLocaleString()}
          </span>
        )}
        {!hasOverlay && <span className="text-xs text-gray-500">(unavailable)</span>}
      </div>
      <Toggle
        checked={enabled}
        onChange={onChange}
        aria-label={enabled ? 'Disable cell overlays' : 'Enable cell overlays'}
        size="sm"
        disabled={!hasOverlay}
      />
    </div>
  )
}
