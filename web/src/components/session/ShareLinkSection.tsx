import { Button } from '../ui/Button'

export interface ShareLinkSectionProps {
  /** The share URL to display (null if no session yet) */
  shareUrl: string | null
  /** Copy button state for UI feedback */
  copyState: 'idle' | 'success' | 'error'
  /** Whether session is being created */
  isCreatingSession: boolean
  /** Handler for the share/copy button */
  onShare: () => void
}

/**
 * Share link section for the sidebar.
 * Shows the shareable URL with copy button, or a create button if no session exists.
 */
export function ShareLinkSection({
  shareUrl,
  copyState,
  isCreatingSession,
  onShare,
}: ShareLinkSectionProps) {
  return (
    <div className="mb-4">
      <p className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
        Share Link
      </p>
      {shareUrl ? (
        <div className="relative">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="w-full text-gray-300 text-sm rounded px-2 py-1.5 pr-14 border-0 focus:outline-none focus:ring-1 focus:ring-blue-500 truncate"
            style={{ backgroundColor: '#3C3C3C' }}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            title={shareUrl}
            aria-label="Share URL"
          />
          <button
            onClick={onShare}
            disabled={copyState === 'success'}
            className={`absolute right-1 top-1 bottom-1 px-2 text-xs font-medium rounded transition-colors ${
              copyState === 'success'
                ? 'bg-green-600 text-white'
                : copyState === 'error'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-white hover:opacity-80'
            }`}
            style={
              copyState !== 'success' && copyState !== 'error'
                ? { backgroundColor: '#575759' }
                : undefined
            }
            aria-label={copyState === 'success' ? 'Copied' : 'Copy share link'}
          >
            {copyState === 'success' ? 'Copied!' : copyState === 'error' ? 'Retry' : 'Copy'}
          </button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={onShare}
          className="w-full"
          loading={isCreatingSession}
        >
          {isCreatingSession ? 'Creating...' : 'Create Share Link'}
        </Button>
      )}
    </div>
  )
}
