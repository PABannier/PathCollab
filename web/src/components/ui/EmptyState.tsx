import { Button } from './Button'

export interface EmptyStateAction {
  label: string
  onClick: () => void
}

export interface EmptyStateLink {
  label: string
  href: string
}

export interface EmptyStateProps {
  /** Icon or illustration to display */
  icon?: React.ReactNode
  /** Main headline */
  title: string
  /** Brief explanation */
  description: string
  /** Primary action button */
  action?: EmptyStateAction
  /** Secondary action - link to docs or help */
  secondary?: EmptyStateLink
  /** Additional CSS classes */
  className?: string
}

/**
 * Premium empty state component with helpful guidance.
 * Used when there's no data to display or an error occurred.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      {icon && <div className="mb-4 text-gray-400">{icon}</div>}
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 max-w-sm mb-4">{description}</p>
      {(action || secondary) && (
        <div className="flex flex-col items-center gap-3">
          {action && (
            <Button onClick={action.onClick} variant="primary" size="md">
              {action.label}
            </Button>
          )}
          {secondary && (
            <a
              href={secondary.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
            >
              {secondary.label}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// Preset icons for common empty states
const Icons = {
  microscope: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  ),
  solo: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  ),
  layers: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  ),
  expired: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  offline: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
      />
    </svg>
  ),
  notFound: (
    <svg
      className="w-16 h-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  loading: (
    <div className="w-12 h-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
  ),
}

// Preset empty states for common scenarios
export type EmptyStatePreset =
  | 'no-slides'
  | 'solo-mode'
  | 'no-overlay'
  | 'session-expired'
  | 'offline'
  | 'session-not-found'
  | 'loading'
  | 'connecting'

export interface PresetEmptyStateProps {
  /** Which preset to use */
  preset: EmptyStatePreset
  /** Optional action override */
  action?: EmptyStateAction
  /** Optional secondary link override */
  secondary?: EmptyStateLink
  /** Additional CSS classes */
  className?: string
}

const presetConfigs: Record<EmptyStatePreset, Omit<EmptyStateProps, 'action' | 'className'>> = {
  'no-slides': {
    icon: Icons.microscope,
    title: 'No Slides Available',
    description:
      'Place whole-slide images (.svs, .ndpi, .tiff) in the slides directory to get started.',
    secondary: {
      label: 'View setup guide',
      href: 'https://github.com/PABannier/PathCollab#quick-start',
    },
  },
  'solo-mode': {
    icon: Icons.solo,
    title: 'Just You',
    description: 'You are viewing this slide in solo mode. Share to collaborate with others.',
  },
  'no-overlay': {
    icon: Icons.layers,
    title: 'No Overlay Loaded',
    description:
      'Upload an overlay to visualize cell segmentation and tissue classification results.',
    secondary: {
      label: 'Learn about overlays',
      href: 'https://github.com/PABannier/PathCollab#overlays',
    },
  },
  'session-expired': {
    icon: Icons.expired,
    title: 'Session Ended',
    description: 'This session is no longer active. The presenter may have closed the session.',
  },
  offline: {
    icon: Icons.offline,
    title: 'Connection Lost',
    description: 'Check your internet connection and try again.',
    secondary: {
      label: 'Troubleshooting',
      href: 'https://github.com/PABannier/PathCollab#troubleshooting',
    },
  },
  'session-not-found': {
    icon: Icons.notFound,
    title: 'Session Not Found',
    description:
      'This session does not exist or the link may be invalid. Check the URL and try again.',
  },
  loading: {
    icon: Icons.loading,
    title: 'Loading',
    description: 'Please wait while we load the content...',
  },
  connecting: {
    icon: Icons.loading,
    title: 'Connecting',
    description: 'Connecting to the server...',
  },
}

/**
 * Convenience wrapper for common empty state scenarios.
 * Pass action or secondary to override the preset defaults.
 */
export function PresetEmptyState({ preset, action, secondary, className }: PresetEmptyStateProps) {
  const config = presetConfigs[preset]
  return (
    <EmptyState
      {...config}
      action={action}
      secondary={secondary ?? config.secondary}
      className={className}
    />
  )
}
