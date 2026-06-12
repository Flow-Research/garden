import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@garden/ui/components/ui/sidebar'
import {
  BadgeCheckIcon,
  Building2Icon,
  LogOutIcon,
  ShieldIcon,
} from 'lucide-react'

export function NavUser({
  user,
  onAccount,
  onCreateWorkspace,
  onLogout,
}: {
  user: {
    name: string
    email: string
    avatar?: string | null
  }
  onAccount: () => void
  onCreateWorkspace: () => void
  onLogout: () => void
}) {
  const { isMobile } = useSidebar()
  const initials = user.name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip="Account"
                aria-label="Account"
                className="!h-12 !w-full !gap-0 !p-0 justify-center !rounded-none group-data-[collapsible=icon]:!h-12 group-data-[collapsible=icon]:!w-full aria-expanded:bg-muted aria-expanded:text-foreground"
              />
            }
          >
            <Avatar className="size-7">
              <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-2 py-2 text-left text-sm">
                  <Avatar>
                    <AvatarImage
                      src={user.avatar ?? undefined}
                      alt={user.name}
                    />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onCreateWorkspace}>
                <Building2Icon />
                New workspace
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAccount}>
                <BadgeCheckIcon />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAccount}>
                <ShieldIcon />
                Sessions & security
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
