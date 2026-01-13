import { useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { SlideViewer, type SlideInfo } from '../components/viewer'

// Demo slide configuration - will be replaced with actual data from backend
const DEMO_SLIDE_BASE: Omit<SlideInfo, 'tileUrlTemplate'> = {
  id: 'demo',
  name: 'Demo Slide',
  width: 100000,
  height: 100000,
  tileSize: 256,
  numLevels: 10,
}

export function Session() {
  const { id } = useParams<{ id: string }>()

  // Build slide config with proper tile URL template
  const slide = useMemo((): SlideInfo => {
    const slideId = DEMO_SLIDE_BASE.id
    return {
      ...DEMO_SLIDE_BASE,
      tileUrlTemplate: `/api/slide/${slideId}/tile/{level}/{x}/{y}`,
    }
  }, [])

  const handleViewportChange = useCallback(
    (viewport: { centerX: number; centerY: number; zoom: number }) => {
      // Will be used for presence sync
      console.log('Viewport changed:', viewport)
    },
    []
  )

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">PathCollab</h1>
          <span className="text-sm text-gray-400">Session: {id}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
            Share
          </button>
        </div>
      </header>

      {/* Main viewer area */}
      <main className="flex-1 overflow-hidden">
        <SlideViewer slide={slide} onViewportChange={handleViewportChange} />
      </main>
    </div>
  )
}
