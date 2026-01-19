import type { SlideListItem } from '../../hooks/useAvailableSlides'

export interface SlideSelectorProps {
  /** Currently selected slide ID */
  currentSlideId: string
  /** Name of the current slide */
  currentSlideName: string
  /** List of available slides to choose from */
  availableSlides: SlideListItem[]
  /** Whether the user is the presenter (can change slides) */
  isPresenter: boolean
  /** Callback when slide selection changes */
  onSlideChange: (slideId: string) => void
}

/**
 * Slide selector component for the sidebar.
 * Shows a dropdown for presenters with multiple slides, or just the slide name otherwise.
 */
export function SlideSelector({
  currentSlideId,
  currentSlideName,
  availableSlides,
  isPresenter,
  onSlideChange,
}: SlideSelectorProps) {
  const canSelectSlide = isPresenter && availableSlides.length > 1

  return (
    <div className="mb-4">
      <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
        {canSelectSlide ? 'Choose Slide' : 'Current Slide'}
      </p>
      {canSelectSlide ? (
        <select
          value={currentSlideId}
          onChange={(e) => onSlideChange(e.target.value)}
          className="w-full text-gray-300 text-sm rounded px-2 py-1.5 border-0 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          style={{ backgroundColor: '#3C3C3C' }}
          aria-label="Select slide"
        >
          {availableSlides.map((slide) => (
            <option key={slide.id} value={slide.id}>
              {slide.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-gray-400 text-sm truncate" title={currentSlideName}>
          {currentSlideName}
        </p>
      )}
    </div>
  )
}
