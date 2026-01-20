import { useState } from 'react'
import { Toggle } from './Toggle'

interface OverlayControlsProps {
  /** Whether cell overlays are enabled */
  cellOverlaysEnabled: boolean
  /** Callback when cell overlay toggle changes */
  onCellOverlaysChange: (enabled: boolean) => void
  /** Whether cell overlay data is available for this slide */
  hasCellOverlay: boolean
  /** Whether cell overlay is currently loading */
  isOverlayLoading?: boolean
  /** Total number of cells in the overlay */
  cellCount?: number
  /** Current opacity value (0-1) */
  opacity: number
  /** Callback when opacity changes */
  onOpacityChange: (opacity: number) => void
  /** Available cell types from overlay metadata */
  cellTypes: string[]
  /** Currently visible cell types */
  visibleCellTypes: Set<string>
  /** Callback when visible cell types change */
  onVisibleCellTypesChange: (types: Set<string>) => void
}

/**
 * Overlay controls section for the sidebar.
 * Provides toggles for cell and tissue overlays with additional options.
 */
export function OverlayControls({
  cellOverlaysEnabled,
  onCellOverlaysChange,
  hasCellOverlay,
  isOverlayLoading = false,
  cellCount,
  opacity,
  onOpacityChange,
  cellTypes,
  visibleCellTypes,
  onVisibleCellTypesChange,
}: OverlayControlsProps) {
  const [showTissueTooltip, setShowTissueTooltip] = useState(false)

  const handleCellTypeToggle = (cellType: string) => {
    const newVisible = new Set(visibleCellTypes)
    if (newVisible.has(cellType)) {
      newVisible.delete(cellType)
    } else {
      newVisible.add(cellType)
    }
    onVisibleCellTypesChange(newVisible)
  }

  const handleSelectAll = () => {
    onVisibleCellTypesChange(new Set(cellTypes))
  }

  const handleSelectNone = () => {
    onVisibleCellTypesChange(new Set())
  }

  return (
    <div className="mb-4">
      <p className="font-bold text-gray-300 mb-3" style={{ fontSize: '1rem' }}>
        Overlays
      </p>

      <div className="space-y-3">
        {/* Cell Overlays Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${hasCellOverlay || isOverlayLoading ? 'text-gray-300' : 'text-gray-500'}`}
            >
              Cell overlays
            </span>
            {/* Show cell count when ready */}
            {cellOverlaysEnabled &&
              hasCellOverlay &&
              !isOverlayLoading &&
              cellCount !== undefined && (
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
            {/* Loading spinner */}
            {isOverlayLoading && (
              <span className="flex items-center gap-1.5 text-gray-400">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-xs">(loading)</span>
              </span>
            )}
            {/* Only show unavailable if not loading */}
            {!hasCellOverlay && !isOverlayLoading && (
              <span className="text-xs text-gray-500">(unavailable)</span>
            )}
          </div>
          <Toggle
            checked={cellOverlaysEnabled}
            onChange={onCellOverlaysChange}
            aria-label={cellOverlaysEnabled ? 'Disable cell overlays' : 'Enable cell overlays'}
            size="sm"
            disabled={!hasCellOverlay || isOverlayLoading}
          />
        </div>

        {/* Cell Overlay Options (shown when enabled) */}
        {cellOverlaysEnabled && hasCellOverlay && (
          <div className="pl-2 border-l-2 border-gray-700 space-y-3 mt-2">
            {/* Opacity Slider */}
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
              <span className="text-xs text-gray-400 w-8 text-right">
                {Math.round(opacity * 100)}%
              </span>
            </div>

            {/* Cell Types Filter */}
            {cellTypes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Cell types</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      All
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={handleSelectNone}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {cellTypes.map((cellType) => (
                    <label key={cellType} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={visibleCellTypes.has(cellType)}
                        onChange={() => handleCellTypeToggle(cellType)}
                        className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-sm text-gray-300 group-hover:text-gray-200 capitalize">
                        {cellType.replace(/_/g, ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tissue Overlays Toggle (disabled with tooltip) */}
        <div
          className="flex items-center justify-between relative"
          onMouseEnter={() => setShowTissueTooltip(true)}
          onMouseLeave={() => setShowTissueTooltip(false)}
        >
          <span className="text-sm text-gray-500">Tissue overlays</span>
          <Toggle
            checked={false}
            onChange={() => {}}
            aria-label="Tissue overlays coming soon"
            size="sm"
            disabled
          />
          {showTissueTooltip && (
            <div
              className="absolute left-0 bottom-full mb-1 px-2 py-1 text-xs text-white rounded shadow-lg whitespace-nowrap z-10"
              style={{ backgroundColor: 'var(--color-gray-700, #374151)' }}
            >
              Coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
