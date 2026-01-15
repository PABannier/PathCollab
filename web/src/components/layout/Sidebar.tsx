import { type ReactNode, useId } from 'react'

interface SidebarProps {
  children: ReactNode
}

/**
 * Fixed sidebar component for the viewer layout.
 * Uses design token: --sidebar-width (280px)
 */
export function Sidebar({ children }: SidebarProps) {
  const sidebarId = useId()

  return (
    <aside
      id={sidebarId}
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--sidebar-width)',
        backgroundColor: 'var(--sidebar-bg)',
      }}
      role="complementary"
      aria-label="Session sidebar"
    >
      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-4" aria-label="Session navigation">
        {children}
      </nav>
    </aside>
  )
}

interface SidebarSectionProps {
  title: string
  children: ReactNode
}

/**
 * Static section within the sidebar.
 * Displays a title and content without collapse functionality.
 */
export function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <div className="mb-6">
      <h3 className="font-bold text-gray-300 mb-2" style={{ fontSize: '1rem' }}>
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}
