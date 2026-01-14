import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'

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
  const sidebarId = useId()

  return (
    <>
      {/* Sidebar */}
      <aside
        id={sidebarId}
        className="flex flex-col overflow-hidden"
        style={{
          width: isOpen ? 'var(--sidebar-width)' : '0',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: isOpen ? '1px solid var(--sidebar-border)' : 'none',
          transition: `width var(--transition-normal) var(--ease-default)`,
        }}
        aria-hidden={!isOpen}
        role="complementary"
        aria-label="Session sidebar"
      >
        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden p-4"
          aria-label="Session navigation"
        >
          {children}
        </nav>
      </aside>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 -translate-y-1/2 text-gray-300 rounded-r-md p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        style={{
          left: isOpen ? 'var(--sidebar-width)' : '0',
          backgroundColor: 'var(--color-gray-700)',
          zIndex: 'var(--z-dropdown)',
          transition: `left var(--transition-normal) var(--ease-default), background-color var(--transition-fast)`,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-gray-600)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-gray-700)')}
        title={`${isOpen ? 'Collapse' : 'Expand'} sidebar (Ctrl+\\)`}
        aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={isOpen}
        aria-controls={sidebarId}
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
 * Provides keyboard accessibility with:
 * - Button header that toggles open/closed
 * - aria-expanded for screen readers
 * - Smooth animation via CSS transitions
 * - Visible focus indicators
 */
export function SidebarSection({ title, children, defaultOpen = true }: SidebarSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)
  const contentId = useId()

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Allow Enter and Space to toggle (default button behavior)
    // Arrow keys can be handled at the section level if needed
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Find focusable elements within the section content
      const content = document.getElementById(contentId)
      if (!content || !isExpanded) return

      const focusables = content.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return

      const currentIndex = Array.from(focusables).indexOf(document.activeElement as HTMLElement)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIndex = currentIndex < focusables.length - 1 ? currentIndex + 1 : 0
        focusables[nextIndex]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusables.length - 1
        focusables[prevIndex]?.focus()
      }
    }
  }

  return (
    <div className="mb-4" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 py-1 px-1 -mx-1 rounded hover:bg-gray-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-800 transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        id={contentId}
        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
        aria-hidden={!isExpanded}
      >
        {children}
      </div>
    </div>
  )
}
