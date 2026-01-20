import { Toggle } from './Toggle'

interface CellOverlayToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
  hasOverlay: boolean
  cellCount?: number
  opacity: number
  onOpacityChange: (opacity: number) => void
}

export function CellOverlayToggle({
  enabled,
  onChange,
  hasOverlay,
  cellCount,
  opacity,
  onOpacityChange,
}: CellOverlayToggleProps) {
  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-between">
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

      {enabled && hasOverlay && (
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400 w-14">Opacity</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  )
}
