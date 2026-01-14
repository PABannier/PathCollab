import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  children: ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-[var(--color-primary-500)] text-white
    hover:bg-[var(--color-primary-600)]
    active:bg-[var(--color-primary-700)]
  `,
  secondary: `
    bg-[var(--color-gray-700)] text-[var(--color-gray-100)]
    hover:bg-[var(--color-gray-600)]
    active:bg-[var(--color-gray-500)]
  `,
  ghost: `
    bg-transparent text-[var(--color-gray-300)]
    hover:bg-[var(--color-gray-700)]
    active:bg-[var(--color-gray-600)]
  `,
  danger: `
    bg-[var(--color-error)] text-white
    hover:bg-[var(--color-error-dark)]
    active:bg-red-700
  `,
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-6 text-lg gap-2.5',
}

/**
 * Unified Button component with consistent styling across the app.
 *
 * Variants:
 * - primary: Main actions (blue)
 * - secondary: Secondary actions (gray)
 * - ghost: Tertiary/subtle actions (transparent)
 * - danger: Destructive actions (red)
 *
 * Sizes:
 * - sm: 32px height
 * - md: 40px height (default)
 * - lg: 48px height
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className = '',
    children,
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-medium
        rounded-[var(--btn-radius)]
        transition-colors duration-[var(--transition-fast)]
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
})

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
