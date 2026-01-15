interface ViewportLoaderProps {
  message?: string
  subMessage?: string
}

/**
 * Full-viewport loading spinner for the slide viewer area.
 * Designed to provide visual feedback while slide data loads.
 */
export function ViewportLoader({
  message = 'Loading slide...',
  subMessage = 'Preparing viewport',
}: ViewportLoaderProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-900">
      <div className="flex flex-col items-center gap-4">
        {/* Large spinner */}
        <div className="relative">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-500/30 border-t-blue-500" />
          {/* Inner pulsing dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-3 w-3 animate-pulse rounded-full bg-blue-400" />
          </div>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <p className="text-lg font-medium text-white">{message}</p>
          <p className="text-sm text-gray-400 mt-1">{subMessage}</p>
        </div>
      </div>
    </div>
  )
}
