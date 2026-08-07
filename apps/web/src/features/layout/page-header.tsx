import { cn } from '@garden/ui/lib/utils'
import {
  SidebarTrigger,
  useOptionalSidebar,
} from '@garden/ui/components/ui/sidebar'

interface PageHeaderProps {
  children: React.ReactNode
  className?: string
}

/**
 * Keeps page actions aligned across standalone and shell-rendered routes. The
 * mobile navigation affordance appears only when a sidebar provider exists.
 */
export function PageHeader({ children, className }: PageHeaderProps) {
  const sidebar = useOptionalSidebar()

  return (
    <header
      className={cn('flex h-12 shrink-0 items-center border-b px-4', className)}
    >
      {sidebar ? <SidebarTrigger className="mr-2 md:hidden" /> : null}
      {children}
    </header>
  )
}
