import { Toggle } from './Toggle'
import type { TissueClassInfo } from '../../types/overlay'

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
  /** Whether tissue overlays are enabled */
  tissueOverlaysEnabled?: boolean
  /** Callback when tissue overlay toggle changes */
  onTissueOverlaysChange?: (enabled: boolean) => void
  /** Whether tissue overlay data is available */
  hasTissueOverlay?: boolean
  /** Whether tissue overlay is currently loading */
  isTissueOverlayLoading?: boolean
  /** Current tissue opacity value (0-1) */
  tissueOpacity?: number
  /** Callback when tissue opacity changes */
  onTissueOpacityChange?: (opacity: number) => void
  /** Available tissue classes from metadata */
  tissueClasses?: TissueClassInfo[]
  /** Currently visible tissue class IDs */
  visibleTissueClasses?: Set<number>
  /** Callback when visible tissue classes change */
  onVisibleTissueClassesChange?: (classes: Set<number>) => void
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
  tissueOverlaysEnabled = false,
  onTissueOverlaysChange,
  hasTissueOverlay = false,
  isTissueOverlayLoading = false,
  tissueOpacity = 0.7,
  onTissueOpacityChange,
  tissueClasses = [],
  visibleTissueClasses = new Set(),
  onVisibleTissueClassesChange,
}: OverlayControlsProps) {
  const handleCellTypeToggle = (cellType: string) => {
    const newVisible = new Set(visibleCellTypes)
    if (newVisible.has(cellType)) {
      newVisible.delete(cellType)
    } else {
      newVisible.add(cellType)
    }
    onVisibleCellTypesChange(newVisible)
  }

  const handleSelectAllCellTypes = () => {
    onVisibleCellTypesChange(new Set(cellTypes))
  }

  const handleSelectNoCellTypes = () => {
    onVisibleCellTypesChange(new Set())
  }

  const handleTissueClassToggle = (classId: number) => {
    const newVisible = new Set(visibleTissueClasses)
    if (newVisible.has(classId)) {
      newVisible.delete(classId)
    } else {
      newVisible.add(classId)
    }
    onVisibleTissueClassesChange?.(newVisible)
  }

  const handleSelectAllTissueClasses = () => {
    onVisibleTissueClassesChange?.(new Set(tissueClasses.map((c) => c.id)))
  }

  const handleSelectNoTissueClasses = () => {
    onVisibleTissueClassesChange?.(new Set())
  }

  // Check if tissue controls are available
  const tissueControlsAvailable = onTissueOverlaysChange !== undefined

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
                      onClick={handleSelectAllCellTypes}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      All
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={handleSelectNoCellTypes}
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

        {/* Tissue Overlays Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${hasTissueOverlay || isTissueOverlayLoading ? 'text-gray-300' : 'text-gray-500'}`}
            >
              Tissue overlays
            </span>
            {/* Loading spinner */}
            {isTissueOverlayLoading && (
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
            {/* Only show unavailable if not loading and controls are available */}
            {tissueControlsAvailable && !hasTissueOverlay && !isTissueOverlayLoading && (
              <span className="text-xs text-gray-500">(unavailable)</span>
            )}
          </div>
          <Toggle
            checked={tissueOverlaysEnabled}
            onChange={onTissueOverlaysChange ?? (() => {})}
            aria-label={
              tissueOverlaysEnabled ? 'Disable tissue overlays' : 'Enable tissue overlays'
            }
            size="sm"
            disabled={!tissueControlsAvailable || !hasTissueOverlay || isTissueOverlayLoading}
          />
        </div>

        {/* Tissue Overlay Options (shown when enabled) */}
        {tissueOverlaysEnabled && hasTissueOverlay && (
          <div className="pl-2 border-l-2 border-gray-700 space-y-3 mt-2">
            {/* Opacity Slider */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 w-14">Opacity</label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={tissueOpacity}
                onChange={(e) => onTissueOpacityChange?.(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-xs text-gray-400 w-8 text-right">
                {Math.round(tissueOpacity * 100)}%
              </span>
            </div>

            {/* Tissue Classes Filter */}
            {tissueClasses.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Tissue types</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllTissueClasses}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      All
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={handleSelectNoTissueClasses}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {tissueClasses.map((tissueClass) => (
                    <label
                      key={tissueClass.id}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={visibleTissueClasses.has(tissueClass.id)}
                        onChange={() => handleTissueClassToggle(tissueClass.id)}
                        className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-sm text-gray-300 group-hover:text-gray-200 capitalize">
                        {tissueClass.name.replace(/_/g, ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
