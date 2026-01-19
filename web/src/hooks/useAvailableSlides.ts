import { useQuery } from '@tanstack/react-query'

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

async function fetchAvailableSlides(): Promise<SlideListItem[]> {
  const response = await fetch('/api/slides')

  if (!response.ok) {
    throw new Error(`Failed to fetch slides: ${response.status}`)
  }

  return response.json()
}

/**
 * Hook to fetch all available slides from the server.
 * Uses React Query for caching, deduplication, and stale-while-revalidate.
 */
export function useAvailableSlides(): UseAvailableSlidesReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['slides', 'list'],
    queryFn: fetchAvailableSlides,
  })

  return {
    slides: data ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: () => void refetch(),
  }
}
