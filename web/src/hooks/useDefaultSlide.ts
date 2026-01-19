import { useQuery } from '@tanstack/react-query'

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

async function fetchDefaultSlide(): Promise<DefaultSlide | null> {
  const response = await fetch('/api/slides/default')

  if (!response.ok) {
    if (response.status === 404) {
      // No slides available - not an error, just empty
      return null
    }
    throw new Error(`Failed to fetch default slide: ${response.status}`)
  }

  return response.json()
}

/**
 * Hook to fetch the default slide from the server.
 * Uses React Query for caching, deduplication, and stale-while-revalidate.
 */
export function useDefaultSlide(): UseDefaultSlideReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['slide', 'default'],
    queryFn: fetchDefaultSlide,
  })

  return {
    slide: data ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: () => void refetch(),
  }
}
