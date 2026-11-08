import { cn } from '@garden/ui/lib/utils'

interface PageHeaderProps {
  children: React.ReactNode
  className?: string
}

/** Keeps page actions aligned across standalone and shell-rendered routes. */
export function PageHeader({ children, className }: PageHeaderProps) {
  return (
    <header
      className={cn('flex h-12 shrink-0 items-center border-b px-4', className)}
    >
      {children}
    </header>
  )
}
