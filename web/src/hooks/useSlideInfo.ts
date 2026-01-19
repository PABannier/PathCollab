import { useMemo } from 'react'
import type { SlideInfo } from './useSession'
import type { DefaultSlide } from './useDefaultSlide'

/** Slide data as returned from the session */
export interface SessionSlide {
  id: string
  name: string
  width: number
  height: number
  tile_size: number
  num_levels: number
  tile_url_template: string
}

export interface UseSlideInfoOptions {
  /** Session slide info (from active session) */
  sessionSlide: SessionSlide | undefined
  /** Default slide from API (for standalone mode) */
  defaultSlide: DefaultSlide | null
  /** Whether we're waiting for session to be created */
  isWaitingForSession: boolean
  /** Whether default slide is still loading */
  isLoadingDefaultSlide: boolean
}

/** Demo slide configuration - used as fallback when no slides available */
const DEMO_SLIDE_BASE: Omit<SlideInfo, 'tileUrlTemplate'> = {
  id: 'demo',
  name: 'Demo Slide',
  width: 100000,
  height: 100000,
  tileSize: 256,
  numLevels: 10,
}

/**
 * Hook for deriving the current slide info from various sources.
 *
 * Priority order:
 * 1. Session slide (if in an active session)
 * 2. Default slide from API (for standalone viewer mode)
 * 3. Demo slide fallback
 *
 * Returns null during loading states to show appropriate loading UI.
 */
export function useSlideInfo({
  sessionSlide,
  defaultSlide,
  isWaitingForSession,
  isLoadingDefaultSlide,
}: UseSlideInfoOptions): SlideInfo | null {
  return useMemo((): SlideInfo | null => {
    // 1. Use session slide if available
    if (sessionSlide) {
      return {
        id: sessionSlide.id,
        name: sessionSlide.name,
        width: sessionSlide.width,
        height: sessionSlide.height,
        tileSize: sessionSlide.tile_size,
        numLevels: sessionSlide.num_levels,
        tileUrlTemplate: sessionSlide.tile_url_template,
      }
    }

    // 2. Don't show anything if we're waiting for session creation
    if (isWaitingForSession) {
      return null
    }

    // 3. Use default slide from API (for standalone viewer mode)
    if (defaultSlide) {
      // Calculate numLevels from slide dimensions (DZI formula)
      const maxDim = Math.max(defaultSlide.width, defaultSlide.height)
      const numLevels = maxDim > 0 ? Math.ceil(Math.log2(maxDim)) + 1 : 1
      return {
        id: defaultSlide.slide_id,
        name: defaultSlide.name,
        width: defaultSlide.width,
        height: defaultSlide.height,
        tileSize: 256,
        numLevels,
        tileUrlTemplate: `/api/slide/${defaultSlide.slide_id}/tile/{level}/{x}/{y}`,
      }
    }

    // 4. Show loading state while fetching default slide
    if (isLoadingDefaultSlide) {
      return null
    }

    // 5. Fallback to demo slide if no slides available
    return {
      ...DEMO_SLIDE_BASE,
      tileUrlTemplate: `/api/slide/${DEMO_SLIDE_BASE.id}/tile/{level}/{x}/{y}`,
    }
  }, [sessionSlide, defaultSlide, isWaitingForSession, isLoadingDefaultSlide])
}
