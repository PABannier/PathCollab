import type { Participant } from '../../hooks/useSession'

export interface ActiveUsersListProps {
  /** The session presenter */
  presenter: Participant
  /** List of followers in the session */
  followers: Participant[]
  /** Current user's ID (to show "(you)" label) */
  currentUserId: string | undefined
}

/**
 * Active users list component for the sidebar.
 * Shows all participants in the session with their colors and roles.
 */
export function ActiveUsersList({ presenter, followers, currentUserId }: ActiveUsersListProps) {
  return (
    <div className="mb-4">
      <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
        Active Users
      </p>
      <div className="flex flex-col gap-1">
        {/* Presenter */}
        <UserListItem
          participant={presenter}
          isCurrentUser={currentUserId === presenter.id}
          isPresenter
        />
        {/* Followers */}
        {followers.map((follower) => (
          <UserListItem
            key={follower.id}
            participant={follower}
            isCurrentUser={currentUserId === follower.id}
          />
        ))}
      </div>
    </div>
  )
}

interface UserListItemProps {
  participant: Participant
  isCurrentUser: boolean
  isPresenter?: boolean
}

function UserListItem({ participant, isCurrentUser, isPresenter = false }: UserListItemProps) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
      style={{ backgroundColor: 'var(--color-gray-700)' }}
    >
      <span
        className="h-2 w-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: participant.color }}
        aria-hidden="true"
      />
      <span className="text-gray-300">
        {participant.name}
        {isCurrentUser && <span className="text-gray-400 ml-1">(you)</span>}
      </span>
      {isPresenter && (
        <span
          className="ml-auto flex items-center gap-1"
          style={{ color: 'var(--color-accent-purple)' }}
        >
          <span className="text-xs" aria-hidden="true">
            ★
          </span>
          <span className="text-gray-500">host</span>
        </span>
      )}
    </div>
  )
}
