import { useCallback, useState, useRef } from 'react'

interface OverlayUploaderProps {
  sessionId: string
  presenterKey?: string | null
  onUploadComplete: (overlayId: string) => void
  onError: (error: string) => void
  disabled?: boolean
}

interface UploadResponse {
  success: boolean
  overlay_id: string
  content_sha256: string
  total_raster_tiles: number
  total_vector_chunks: number
  error?: string
}

type UploadState = 'idle' | 'uploading' | 'processing' | 'complete' | 'error'

export function OverlayUploader({
  sessionId,
  presenterKey,
  onUploadComplete,
  onError,
  disabled = false,
}: OverlayUploaderProps) {
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastFileRef = useRef<File | null>(null)

  const uploadFile = useCallback(
    async (file: File) => {
      if (!sessionId) {
        onError('No active session')
        return
      }
      if (!presenterKey) {
        onError('Presenter key required to upload overlays')
        return
      }

      // Validate file type
      if (!file.name.endsWith('.pb') && !file.name.endsWith('.proto')) {
        onError('Invalid file type. Please upload a .pb file')
        return
      }

      // Validate file size (500MB max)
      const maxSize = 500 * 1024 * 1024
      if (file.size > maxSize) {
        onError('File too large. Maximum size is 500MB')
        return
      }

      // Store file for potential retry
      lastFileRef.current = file
      setFileName(file.name)
      setUploadState('uploading')
      setProgress(0)
      setLastError(null)

      try {
        // Read file as ArrayBuffer
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(new Error('Failed to read file'))
          reader.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 50)) // 0-50% for reading
            }
          }
          reader.readAsArrayBuffer(file)
        })

        setProgress(50)
        setUploadState('processing')

        // Upload to server
        const response = await fetch(`/api/overlay/upload?session_id=${sessionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Presenter-Key': presenterKey,
          },
          body: arrayBuffer,
        })

        setProgress(90)

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(errorData.error || `Upload failed: ${response.status}`)
        }

        const data: UploadResponse = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Upload failed')
        }

        setProgress(100)
        setUploadState('complete')
        onUploadComplete(data.overlay_id)

        // Reset after a delay
        setTimeout(() => {
          setUploadState('idle')
          setProgress(0)
          setFileName(null)
        }, 2000)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed'
        // Categorize error for better guidance
        const isNetworkError =
          errorMessage.includes('network') ||
          errorMessage.includes('fetch') ||
          errorMessage.includes('Failed to fetch')
        const friendlyMessage = isNetworkError
          ? 'Connection lost during upload. Please try again.'
          : errorMessage
        setUploadState('error')
        setLastError(friendlyMessage)
        onError(friendlyMessage)
        // Don't auto-reset on error - let user retry
      }
    },
    [sessionId, presenterKey, onUploadComplete, onError]
  )

  const handleRetry = useCallback(() => {
    if (lastFileRef.current) {
      uploadFile(lastFileRef.current)
    } else {
      // Reset to idle if no file to retry
      setUploadState('idle')
      setProgress(0)
      setFileName(null)
      setLastError(null)
    }
  }, [uploadFile])

  const handleDismissError = useCallback(() => {
    setUploadState('idle')
    setProgress(0)
    setFileName(null)
    setLastError(null)
    lastFileRef.current = null
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        uploadFile(file)
      }
      // Reset input so same file can be re-selected
      e.target.value = ''
    },
    [uploadFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file) {
        uploadFile(file)
      }
    },
    [uploadFile]
  )

  const handleClick = useCallback(() => {
    if (uploadState === 'idle' && !disabled) {
      fileInputRef.current?.click()
    }
  }, [uploadState, disabled])

  const isUploading = uploadState === 'uploading' || uploadState === 'processing'

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pb,.proto"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isUploading}
      />

      <button
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled || isUploading}
        className={`
          relative flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-all border
          ${isDragging ? 'ring-2 ring-green-400 border-green-400 bg-green-600' : ''}
          ${
            uploadState === 'idle'
              ? 'bg-transparent border-emerald-500 text-emerald-500 hover:bg-emerald-500/10'
              : uploadState === 'complete'
                ? 'bg-transparent border-green-500 text-green-500'
                : uploadState === 'error'
                  ? 'bg-transparent border-red-500 text-red-500'
                  : 'bg-transparent border-gray-500 text-gray-400'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        title={isDragging ? 'Drop file here' : 'Upload overlay (.pb file)'}
      >
        {/* Icon */}
        {uploadState === 'idle' && (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        )}
        {uploadState === 'uploading' && (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {uploadState === 'processing' && (
          <svg
            className="h-4 w-4 animate-pulse"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
        )}
        {uploadState === 'complete' && (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {uploadState === 'error' && (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        )}

        {/* Text */}
        <span>
          {uploadState === 'idle' && 'Upload overlay'}
          {uploadState === 'uploading' && `Uploading... ${progress}%`}
          {uploadState === 'processing' && 'Processing...'}
          {uploadState === 'complete' && 'Complete!'}
          {uploadState === 'error' && 'Failed'}
        </span>

        {/* Progress bar */}
        {isUploading && (
          <div className="absolute bottom-0 left-0 h-0.5 bg-white/30 w-full overflow-hidden rounded-b">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </button>

      {/* File name tooltip */}
      {fileName && isUploading && (
        <div className="absolute top-full mt-1 left-0 text-xs text-gray-400 truncate max-w-48">
          {fileName}
        </div>
      )}

      {/* Error state with retry/dismiss */}
      {uploadState === 'error' && (
        <div className="absolute top-full mt-2 left-0 flex flex-col gap-1 text-xs">
          {lastError && (
            <span className="text-red-400 max-w-48 truncate" title={lastError}>
              {lastError}
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleRetry}
              className="text-blue-400 hover:text-blue-300 hover:underline"
            >
              Retry
            </button>
            <button
              onClick={handleDismissError}
              className="text-gray-400 hover:text-gray-300 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
