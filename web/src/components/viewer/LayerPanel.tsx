import { useState, useCallback } from 'react'

interface LayerPanelProps {
  // Tissue heatmap controls
  tissueEnabled: boolean
  onTissueEnabledChange: (enabled: boolean) => void
  tissueOpacity: number
  onTissueOpacityChange: (opacity: number) => void
  tissueClasses: ClassInfo[]
  visibleTissueClasses: number[]
  onVisibleTissueClassesChange: (classes: number[]) => void

  // Cell overlay controls
  cellsEnabled: boolean
  onCellsEnabledChange: (enabled: boolean) => void
  cellsOpacity: number
  onCellsOpacityChange: (opacity: number) => void
  cellClasses: ClassInfo[]
  visibleCellClasses: number[]
  onVisibleCellClassesChange: (classes: number[]) => void
  cellHoverEnabled?: boolean
  onCellHoverEnabledChange?: (enabled: boolean) => void

  // Panel state
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

interface ClassInfo {
  id: number
  name: string
  color: string
}

export function LayerPanel({
  tissueEnabled,
  onTissueEnabledChange,
  tissueOpacity,
  onTissueOpacityChange,
  tissueClasses,
  visibleTissueClasses,
  onVisibleTissueClassesChange,
  cellsEnabled,
  onCellsEnabledChange,
  cellsOpacity,
  onCellsOpacityChange,
  cellClasses,
  visibleCellClasses,
  onVisibleCellClassesChange,
  cellHoverEnabled = true,
  onCellHoverEnabledChange,
  collapsed: initialCollapsed = true,
  onCollapsedChange,
}: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [tissueExpanded, setTissueExpanded] = useState(false)
  const [cellsExpanded, setCellsExpanded] = useState(false)

  const handleCollapsedChange = useCallback((value: boolean) => {
    setCollapsed(value)
    onCollapsedChange?.(value)
  }, [onCollapsedChange])

  const toggleTissueClass = useCallback((classId: number) => {
    if (visibleTissueClasses.includes(classId)) {
      onVisibleTissueClassesChange(visibleTissueClasses.filter(id => id !== classId))
    } else {
      onVisibleTissueClassesChange([...visibleTissueClasses, classId])
    }
  }, [visibleTissueClasses, onVisibleTissueClassesChange])

  const toggleCellClass = useCallback((classId: number) => {
    if (visibleCellClasses.includes(classId)) {
      onVisibleCellClassesChange(visibleCellClasses.filter(id => id !== classId))
    } else {
      onVisibleCellClassesChange([...visibleCellClasses, classId])
    }
  }, [visibleCellClasses, onVisibleCellClassesChange])

  const selectAllTissueClasses = useCallback(() => {
    onVisibleTissueClassesChange(tissueClasses.map(c => c.id))
  }, [tissueClasses, onVisibleTissueClassesChange])

  const selectNoneTissueClasses = useCallback(() => {
    onVisibleTissueClassesChange([])
  }, [onVisibleTissueClassesChange])

  const selectAllCellClasses = useCallback(() => {
    onVisibleCellClassesChange(cellClasses.map(c => c.id))
  }, [cellClasses, onVisibleCellClassesChange])

  const selectNoneCellClasses = useCallback(() => {
    onVisibleCellClassesChange([])
  }, [onVisibleCellClassesChange])

  if (collapsed) {
    return (
      <button
        onClick={() => handleCollapsedChange(false)}
        className="absolute right-4 top-4 z-10 rounded bg-gray-800/90 p-2 text-white hover:bg-gray-700"
        title="Show layer controls"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </button>
    )
  }

  return (
    <div className="absolute right-4 top-4 z-10 w-64 rounded bg-gray-800/95 text-white shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="font-medium text-sm">Layer Controls</span>
        <button
          onClick={() => handleCollapsedChange(true)}
          className="text-gray-400 hover:text-white"
          title="Collapse panel"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {/* Tissue Heatmap Section */}
        <div className="border-b border-gray-700">
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              id="tissue-enabled"
              checked={tissueEnabled}
              onChange={(e) => onTissueEnabledChange(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <label htmlFor="tissue-enabled" className="flex-1 text-sm font-medium cursor-pointer">
              Tissue Heatmap
            </label>
            <button
              onClick={() => setTissueExpanded(!tissueExpanded)}
              className="text-gray-400 hover:text-white"
            >
              <svg
                className={`h-4 w-4 transition-transform ${tissueExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {tissueEnabled && (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14">Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={tissueOpacity * 100}
                  onChange={(e) => onTissueOpacityChange(Number(e.target.value) / 100)}
                  className="flex-1 h-1"
                />
                <span className="text-xs text-gray-400 w-8">{Math.round(tissueOpacity * 100)}%</span>
              </div>
            </div>
          )}

          {tissueExpanded && (
            <div className="px-3 pb-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Classes</span>
                <div className="space-x-2">
                  <button onClick={selectAllTissueClasses} className="hover:text-white">All</button>
                  <button onClick={selectNoneTissueClasses} className="hover:text-white">None</button>
                </div>
              </div>
              {tissueClasses.map((cls) => (
                <label
                  key={cls.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={visibleTissueClasses.includes(cls.id)}
                    onChange={() => toggleTissueClass(cls.id)}
                    className="h-3 w-3 rounded"
                  />
                  <span
                    className="h-3 w-3 rounded"
                    style={{ backgroundColor: cls.color }}
                  />
                  <span className="text-xs">{cls.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Cell Overlay Section */}
        <div>
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              id="cells-enabled"
              checked={cellsEnabled}
              onChange={(e) => onCellsEnabledChange(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <label htmlFor="cells-enabled" className="flex-1 text-sm font-medium cursor-pointer">
              Cell Polygons
            </label>
            <button
              onClick={() => setCellsExpanded(!cellsExpanded)}
              className="text-gray-400 hover:text-white"
            >
              <svg
                className={`h-4 w-4 transition-transform ${cellsExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {cellsEnabled && (
            <div className="px-3 pb-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14">Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cellsOpacity * 100}
                  onChange={(e) => onCellsOpacityChange(Number(e.target.value) / 100)}
                  className="flex-1 h-1"
                />
                <span className="text-xs text-gray-400 w-8">{Math.round(cellsOpacity * 100)}%</span>
              </div>
              {onCellHoverEnabledChange && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cellHoverEnabled}
                    onChange={(e) => onCellHoverEnabledChange(e.target.checked)}
                    className="h-3 w-3 rounded"
                  />
                  <span className="text-xs text-gray-400">Show tooltip on hover</span>
                </label>
              )}
            </div>
          )}

          {cellsExpanded && (
            <div className="px-3 pb-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Classes</span>
                <div className="space-x-2">
                  <button onClick={selectAllCellClasses} className="hover:text-white">All</button>
                  <button onClick={selectNoneCellClasses} className="hover:text-white">None</button>
                </div>
              </div>
              {cellClasses.map((cls) => (
                <label
                  key={cls.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={visibleCellClasses.includes(cls.id)}
                    onChange={() => toggleCellClass(cls.id)}
                    className="h-3 w-3 rounded"
                  />
                  <span
                    className="h-3 w-3 rounded"
                    style={{ backgroundColor: cls.color }}
                  />
                  <span className="text-xs">{cls.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
