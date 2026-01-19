interface ReturnToPresenterButtonProps {
  onClick: () => void
  presenterName?: string
}

export function ReturnToPresenterButton({
  onClick,
  presenterName = 'presenter',
}: ReturnToPresenterButtonProps) {
  return (
    <button
      onClick={onClick}
      className="
        fixed bottom-20 left-1/2 -translate-x-1/2
        flex items-center gap-2 px-4 py-2
        text-sm font-medium text-white
        rounded-full shadow-lg
        transition-all duration-200 ease-out
        hover:scale-105 active:scale-95
        animate-fadeInUp
      "
      style={{
        backgroundColor: 'var(--color-primary-500)',
        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
        zIndex: 'var(--z-fixed)',
      }}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
      Return to {presenterName}
    </button>
  )
}
