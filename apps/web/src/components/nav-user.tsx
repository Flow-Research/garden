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
  CheckIcon,
  LogOutIcon,
  ShieldIcon,
} from 'lucide-react'
import type { Workspace } from '@garden/core/types'

export function NavUser({
  user,
  currentWorkspaceId,
  onAccount,
  onCreateWorkspace,
  onLogout,
  onSwitchWorkspace,
  workspaces,
}: {
  user: {
    name: string
    email: string
    avatar?: string | null
  }
  currentWorkspaceId?: string | null
  onAccount: () => void
  onCreateWorkspace: () => void
  onLogout: () => void
  onSwitchWorkspace: (workspace: Workspace) => void
  workspaces: Workspace[]
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
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Workspaces
              </DropdownMenuLabel>
              {workspaces.length > 0 ? (
                <div className="max-h-48 overflow-y-auto py-1">
                  {workspaces.map((workspace) => {
                    const active = workspace.id === currentWorkspaceId
                    return (
                      <DropdownMenuItem
                        key={workspace.id}
                        disabled={active}
                        onClick={() => onSwitchWorkspace(workspace)}
                      >
                        <Building2Icon />
                        <span className="min-w-0 flex-1 truncate">
                          {workspace.name}
                        </span>
                        {active ? <CheckIcon className="ml-auto" /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              ) : null}
              <DropdownMenuItem onClick={onCreateWorkspace}>
                <Building2Icon />
                New workspace
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
