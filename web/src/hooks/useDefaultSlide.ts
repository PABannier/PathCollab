import { useState, useEffect } from 'react'

export interface DefaultSlide {
  slide_id: string
  source: string
  name: string
  width: number
  height: number
}

interface UseDefaultSlideReturn {
  slide: DefaultSlide | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to fetch the default slide from the server.
 * The server returns the demo slide (if configured) or the first available slide.
 */
export function useDefaultSlide(): UseDefaultSlideReturn {
  const [slide, setSlide] = useState<DefaultSlide | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchCount, setFetchCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function fetchDefaultSlide() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/slides/default')

        if (!response.ok) {
          if (response.status === 404) {
            // No slides available - not an error, just empty
            if (!cancelled) {
              setSlide(null)
              setError(null)
            }
            return
          }
          throw new Error(`Failed to fetch default slide: ${response.status}`)
        }

        const data = await response.json()
        if (!cancelled) {
          setSlide(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setSlide(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchDefaultSlide()

    return () => {
      cancelled = true
    }
  }, [fetchCount])

  const refetch = () => setFetchCount((c) => c + 1)

  return { slide, isLoading, error, refetch }
}
