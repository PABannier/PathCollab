import { type ReactNode } from 'react'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}

/**
 * Collapsible sidebar component for the viewer layout.
 * Uses design token: --sidebar-width (280px)
 */
export function Sidebar({ isOpen, onToggle, children }: SidebarProps) {
  return (
    <>
      {/* Sidebar */}
      <aside
        className="flex flex-col overflow-hidden"
        style={{
          width: isOpen ? 'var(--sidebar-width)' : '0',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: isOpen ? '1px solid var(--sidebar-border)' : 'none',
          transition: `width var(--transition-normal) var(--ease-default)`,
        }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">{children}</div>
      </aside>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 -translate-y-1/2 text-gray-300 rounded-r-md p-1.5"
        style={{
          left: isOpen ? 'var(--sidebar-width)' : '0',
          backgroundColor: 'var(--color-gray-700)',
          zIndex: 'var(--z-dropdown)',
          transition: `left var(--transition-normal) var(--ease-default), background-color var(--transition-fast)`,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-gray-600)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-gray-700)')}
        title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </>
  )
}

interface SidebarSectionProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

/**
 * Collapsible section within the sidebar.
 */
export function SidebarSection({ title, children, defaultOpen = true }: SidebarSectionProps) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className={defaultOpen ? '' : 'hidden'}>{children}</div>
    </div>
  )
}
