import { useState, useEffect, useCallback } from 'react'

export interface SlideListItem {
  id: string
  name: string
  width: number
  height: number
  format: string
}

interface UseAvailableSlidesReturn {
  slides: SlideListItem[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to fetch all available slides from the server.
 */
export function useAvailableSlides(): UseAvailableSlidesReturn {
  const [slides, setSlides] = useState<SlideListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchCount, setFetchCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function fetchSlides() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/slides')

        if (!response.ok) {
          throw new Error(`Failed to fetch slides: ${response.status}`)
        }

        const data = await response.json()
        if (!cancelled) {
          setSlides(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setSlides([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchSlides()

    return () => {
      cancelled = true
    }
  }, [fetchCount])

  const refetch = useCallback(() => setFetchCount((c) => c + 1), [])

  return { slides, isLoading, error, refetch }
}
