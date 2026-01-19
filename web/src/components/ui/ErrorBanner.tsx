import { Button } from './Button'

export interface ErrorBannerProps {
  /** The error message to display */
  message: string
  /** Callback when user dismisses the error */
  onDismiss: () => void
  /** Optional help link URL (shown for upload errors) */
  helpUrl?: string
}

/**
 * Error banner component with dismiss and optional help link.
 * Displayed at the top of the page for actionable errors.
 */
export function ErrorBanner({ message, onDismiss, helpUrl }: ErrorBannerProps) {
  const showHelp = helpUrl || message.toLowerCase().includes('upload')
  const resolvedHelpUrl = helpUrl || 'https://github.com/PABannier/PathCollab#troubleshooting'

  return (
    <div
      className="bg-red-600 px-4 py-2 text-sm text-white flex items-center justify-between gap-4"
      role="alert"
    >
      <div className="flex items-center gap-2 flex-1">
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>{message}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {showHelp && (
          <a
            href={resolvedHelpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/80 hover:text-white underline text-xs"
          >
            Help
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="text-white hover:bg-red-700"
        >
          Dismiss
        </Button>
      </div>
    </div>
  )
}
