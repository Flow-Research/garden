import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { GardenLogo } from '@garden/ui/components/common/garden-logo'
import { cn } from '@garden/ui/lib/utils'
import {
  ChartBar,
  CreditCard,
  CaretDown,
  CaretRight,
  Gear,
  Info,
  PaperPlaneTilt,
  Users,
} from '@phosphor-icons/react'

/**
 * Menu row metrics from the design file (Enterprise flyout, measured):
 * row 265×39 inside 16px flyout padding; icon 18px at 8px inset; 12px
 * icon→label gap; label 14px/400/1.6/+0.02em; hover = background.main.secondary.
 */
const menuItemClass =
  'flex h-10 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm tracking-wider [&_svg]:size-[18px]!'

/**
 * Sidebar header menu — the workspace menu from the design's Enterprise flyout
 * (Penpot "Admin Profile" page): the Garden brand (wave mark + wordmark, per
 * the design — never the workspace name) up top, then Invite
 * members / Workspace settings / Team members live, with Analytics, Billing,
 * and Learn more rendered disabled until those surfaces exist.
 *
 * Workspace switching/creation deliberately lives elsewhere: the account
 * flyout's "Workspaces" row (design's account flow). Collapse control
 * lives in the top bar.
 */
export function WorkspaceMenu({
  collapsed,
  onInviteMembers,
  onOpenSettings,
  onOpenMembers,
}: {
  collapsed?: boolean
  onInviteMembers: () => void
  onOpenSettings: () => void
  onOpenMembers: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Workspace menu"
        className={cn(
          'cursor-pointer flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="flex h-[22px] shrink-0 items-center">
          <GardenLogo className="h-[13px] w-[25px]" />
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-neutral-default">
              Garden
            </span>
            <CaretDown className="size-3.5 shrink-0 text-icon-neutral-tertiary" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[297px] overflow-hidden rounded-xl p-0 shadow-5"
        side="bottom"
        align="start"
        sideOffset={8}
      >
        <div className="flex items-center gap-2 border-b border-border-default bg-background-main-secondary px-3 py-2.5">
          <GardenLogo className="h-[10px] w-[19px]" />
          <span className="truncate text-sm font-semibold text-text-neutral-default">
            Garden
          </span>
        </div>
        <DropdownMenuGroup className="py-1">
          <DropdownMenuItem className={menuItemClass} onClick={onInviteMembers}>
            <PaperPlaneTilt />
            Invite members
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={menuItemClass} onClick={onOpenSettings}>
            <Gear />
            Workspace settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled className={menuItemClass}>
            <ChartBar />
            <span className="flex-1">Analytics</span>
            <span className="text-xs text-text-tertiary">Soon</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled className={menuItemClass}>
            <CreditCard />
            <span className="flex-1">Billing</span>
            <span className="text-xs text-text-tertiary">Soon</span>
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItemClass} onClick={onOpenMembers}>
            <Users />
            Team members
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className={menuItemClass}>
            <Info />
            <span className="flex-1">Learn more</span>
            <span className="text-xs text-text-tertiary">Soon</span>
            <CaretRight className="text-icon-neutral-tertiary" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
