import { useMemo } from 'react'

export interface HashParams {
  /** Join secret for followers to join a session */
  joinSecret: string | undefined
  /** Presenter key for presenter authentication */
  presenterKey: string | undefined
}

/**
 * Hook for parsing URL hash fragment parameters.
 *
 * Secrets are stored in the hash fragment (after #) so they're never sent to the server.
 * This provides security for join secrets and presenter keys.
 *
 * @example
 * // URL: http://localhost/s/abc123#join=secret&presenter=key
 * const { joinSecret, presenterKey } = useHashParams()
 * // joinSecret = "secret", presenterKey = "key"
 */
export function useHashParams(): HashParams {
  return useMemo(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)

    return {
      joinSecret: params.get('join') || undefined,
      presenterKey: params.get('presenter') || undefined,
    }
  }, [])
}
