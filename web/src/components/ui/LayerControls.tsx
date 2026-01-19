import { useState, useCallback } from 'react'

export interface ClassInfo {
  id: number
  name: string
  color: string
}

export interface LayerControlsProps {
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
  cellHoverEnabled: boolean
  onCellHoverEnabledChange: (enabled: boolean) => void

  // Control state
  disabled?: boolean
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

interface ClassesSectionProps {
  classes: ClassInfo[]
  visibleClasses: number[]
  onVisibleClassesChange: (classes: number[]) => void
  disabled: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

function ClassesSection({
  classes,
  visibleClasses,
  onVisibleClassesChange,
  disabled,
  expanded,
  onExpandedChange,
}: ClassesSectionProps) {
  const selectAll = useCallback(
    () => onVisibleClassesChange(classes.map((c) => c.id)),
    [classes, onVisibleClassesChange]
  )
  const selectNone = useCallback(() => onVisibleClassesChange([]), [onVisibleClassesChange])
  const soloClass = useCallback(
    (classId: number) => onVisibleClassesChange([classId]),
    [onVisibleClassesChange]
  )
  const toggleClass = useCallback(
    (classId: number) => {
      if (visibleClasses.includes(classId)) {
        onVisibleClassesChange(visibleClasses.filter((id) => id !== classId))
      } else {
        onVisibleClassesChange([...visibleClasses, classId])
      }
    },
    [visibleClasses, onVisibleClassesChange]
  )

  return (
    <div className="mt-2">
      <button
        onClick={() => onExpandedChange(!expanded)}
        disabled={disabled}
        className={`flex items-center gap-1 text-xs ${
          disabled ? 'text-gray-500 cursor-not-allowed' : 'text-gray-400 hover:text-gray-300'
        }`}
      >
        <ChevronIcon expanded={expanded} />
        Show classes ({classes.length})
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 pl-1">
          <div className="flex justify-end gap-2 text-xs text-gray-400 mb-1">
            <button
              onClick={selectAll}
              disabled={disabled}
              className={disabled ? 'cursor-not-allowed' : 'hover:text-gray-200'}
            >
              All
            </button>
            <button
              onClick={selectNone}
              disabled={disabled}
              className={disabled ? 'cursor-not-allowed' : 'hover:text-gray-200'}
            >
              None
            </button>
          </div>

          {classes.map((cls) => (
            <div
              key={cls.id}
              className={`flex items-center gap-2 group rounded px-1 py-0.5 ${
                disabled ? 'opacity-50' : 'hover:bg-gray-700/50'
              }`}
            >
              <input
                type="checkbox"
                checked={visibleClasses.includes(cls.id)}
                onChange={() => toggleClass(cls.id)}
                disabled={disabled}
                className="h-3 w-3 rounded"
              />
              <span
                className="h-3 w-3 rounded border border-gray-600 flex-shrink-0"
                style={{ backgroundColor: cls.color }}
              />
              <span className="flex-1 text-xs text-gray-300">{cls.name}</span>
              <button
                onClick={() => soloClass(cls.id)}
                disabled={disabled}
                className={`text-xs px-1 ${
                  disabled
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-500 opacity-0 group-hover:opacity-100 hover:text-gray-200'
                }`}
                title={`Show only ${cls.name}`}
              >
                Solo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function LayerControls({
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
  cellHoverEnabled,
  onCellHoverEnabledChange,
  disabled = false,
}: LayerControlsProps) {
  const [tissueExpanded, setTissueExpanded] = useState(false)
  const [cellsExpanded, setCellsExpanded] = useState(false)

  return (
    <div className="space-y-4">
      {/* Tissue Heatmap Section */}
      <div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="layer-tissue-enabled"
            checked={tissueEnabled}
            disabled={disabled}
            onChange={(e) => onTissueEnabledChange(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <label
            htmlFor="layer-tissue-enabled"
            className={`flex-1 text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-300 cursor-pointer'}`}
          >
            Tissue Heatmap
          </label>
        </div>

        {tissueEnabled && (
          <div className="mt-2 pl-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-14">Opacity</span>
              <input
                type="range"
                min="0"
                max="100"
                value={tissueOpacity * 100}
                disabled={disabled}
                onChange={(e) => onTissueOpacityChange(Number(e.target.value) / 100)}
                className="flex-1 h-1"
              />
              <span className="text-xs text-gray-400 w-8">{Math.round(tissueOpacity * 100)}%</span>
            </div>

            <ClassesSection
              classes={tissueClasses}
              visibleClasses={visibleTissueClasses}
              onVisibleClassesChange={onVisibleTissueClassesChange}
              disabled={disabled}
              expanded={tissueExpanded}
              onExpandedChange={setTissueExpanded}
            />
          </div>
        )}
      </div>

      {/* Cell Polygons Section */}
      <div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="layer-cells-enabled"
            checked={cellsEnabled}
            disabled={disabled}
            onChange={(e) => onCellsEnabledChange(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <label
            htmlFor="layer-cells-enabled"
            className={`flex-1 text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-300 cursor-pointer'}`}
          >
            Cell Polygons
          </label>
        </div>

        {cellsEnabled && (
          <div className="mt-2 pl-6 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-14">Opacity</span>
              <input
                type="range"
                min="0"
                max="100"
                value={cellsOpacity * 100}
                disabled={disabled}
                onChange={(e) => onCellsOpacityChange(Number(e.target.value) / 100)}
                className="flex-1 h-1"
              />
              <span className="text-xs text-gray-400 w-8">{Math.round(cellsOpacity * 100)}%</span>
            </div>

            <label
              className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={cellHoverEnabled}
                disabled={disabled}
                onChange={(e) => onCellHoverEnabledChange(e.target.checked)}
                className="h-3 w-3 rounded"
              />
              <span className="text-xs text-gray-400">Show info on hover</span>
            </label>

            <ClassesSection
              classes={cellClasses}
              visibleClasses={visibleCellClasses}
              onVisibleClassesChange={onVisibleCellClassesChange}
              disabled={disabled}
              expanded={cellsExpanded}
              onExpandedChange={setCellsExpanded}
            />
          </div>
        )}
      </div>

      {/* Disabled message for followers */}
      {disabled && (
        <p className="text-xs text-gray-500 italic">Layer controls managed by presenter</p>
      )}
    </div>
  )
}
