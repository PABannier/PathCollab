import { Toggle } from './Toggle'

interface FollowModeIndicatorProps {
  isFollowing: boolean
  onFollowChange: (following: boolean) => void
}

export function FollowModeIndicator({ isFollowing, onFollowChange }: FollowModeIndicatorProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-300">
          {isFollowing ? 'Following presenter' : 'Manual view'}
        </span>
        {isFollowing && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold rounded"
            style={{
              backgroundColor: 'var(--color-success)',
              color: 'white',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
        )}
      </div>
      <Toggle
        checked={isFollowing}
        onChange={onFollowChange}
        aria-label={isFollowing ? 'Stop following presenter' : 'Follow presenter'}
        size="sm"
      />
    </div>
  )
}
