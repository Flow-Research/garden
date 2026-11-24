import { memo, useCallback, useState, type ReactNode } from 'react'
import {
  Crown,
  Shield,
  User,
  MoreHorizontal,
  UserMinus,
  X,
  SendHorizontal,
  Unlink,
} from 'lucide-react'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BrandGithubIcon } from '@/components/icons/brand-github-icon'
import type { MemberWithUser, MemberRole, Invitation } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { LoadError } from '@garden/ui/components/common/load-error'
import { Badge } from '@garden/ui/components/ui/badge'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@garden/ui/components/ui/dropdown-menu'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  memberListOptions,
  invitationListOptions,
  workspaceKeys,
} from '@/lib/workspace/queries'
import { api } from '@/lib/api'
import {
  GithubIdentityLinkDialog,
  githubIdentityStatusLabel,
} from './github-workspace-identity'
import { InviteMembersButton } from './invite-members-dialog'

const roleConfig: Record<
  MemberRole,
  { label: string; icon: typeof Crown; description: string }
> = {
  owner: {
    label: 'Owner',
    icon: Crown,
    description: 'Full access, manage all settings',
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    description: 'Manage members and settings',
  },
  member: {
    label: 'Member',
    icon: User,
    description: 'Create and work on issues',
  },
}

const BADGE_CLASS: Record<MemberRole, string> = {
  owner: 'bg-badge-blue-background text-badge-blue-text',
  admin: 'bg-badge-blue-background text-badge-blue-text',
  member: 'bg-badge-gray-background text-badge-gray-text',
}

/**
 * Rounded table frame that caps its height and scrolls the body under a
 * sticky header. `overflow-y-auto` also clips rows to the rounded corners.
 */
const TABLE_CLASS =
  'max-h-[min(36rem,70vh)] overflow-y-auto rounded-2xl border border-border-default bg-background-main-default'
/**
 * Sticky header row. Its bottom rule is an inset shadow on the cells because
 * the first body row's top border scrolls away with the body, and collapsed
 * table borders do not stick.
 */
const THEAD_CLASS =
  'sticky top-0 z-10 [&_th]:bg-background-main-secondary [&_th]:shadow-[inset_0_-1px_0_var(--border-default)]'
/** The sticky header draws the top rule, so the first row skips its own. */
const TBODY_CLASS = '[&>tr:first-child]:border-t-0'
const TH_CLASS = 'px-4 py-4 font-semibold text-text-default sm:px-6'
/** Header counterpart of the body cells' left border, so dividers run top to bottom. */
const TH_DIVIDER = 'border-l border-border-default'
const TD_CLASS = 'border-l border-border-default px-4 py-4 text-center sm:px-6'

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

function MemberActions({
  member,
  canEditRole,
  canEditGithub,
  canRemove,
  canManageOwners,
  busy,
  onRoleChange,
  onRemove,
  onLinkGithub,
  onUnlinkGithub,
}: {
  member: MemberWithUser
  canEditRole: boolean
  canEditGithub: boolean
  canRemove: boolean
  canManageOwners: boolean
  busy: boolean
  onRoleChange: (role: MemberRole) => void
  onRemove: () => void
  onLinkGithub: () => void
  onUnlinkGithub: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${member.name}`}
            variant="ghost"
            size="icon-sm"
            disabled={busy}
          >
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto">
        {canEditRole && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Shield className="size-3.5" />
              Change role
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto">
              {(
                Object.entries(roleConfig) as [
                  MemberRole,
                  (typeof roleConfig)[MemberRole],
                ][]
              ).map(([role, config]) => {
                if (role === 'owner' && !canManageOwners) return null
                const Icon = config.icon
                return (
                  <DropdownMenuItem
                    key={role}
                    onClick={() => onRoleChange(role)}
                  >
                    <Icon className="size-3.5" />
                    <div className="flex flex-col">
                      <span>{config.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {config.description}
                      </span>
                    </div>
                    {member.role === role && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        &#10003;
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {canEditGithub && (
          <DropdownMenuItem onClick={onLinkGithub}>
            <BrandGithubIcon className="h-3.5 w-3.5" />
            {member.github_login ? 'Edit GitHub identity' : 'Link GitHub'}
          </DropdownMenuItem>
        )}
        {canEditGithub && member.github_login ? (
          <DropdownMenuItem onClick={onUnlinkGithub}>
            <Unlink className="h-3.5 w-3.5" />
            Unlink GitHub
          </DropdownMenuItem>
        ) : null}
        {canRemove && (canEditRole || canEditGithub) ? (
          <DropdownMenuSeparator />
        ) : null}
        {canRemove && (
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <UserMinus className="size-3.5" />
            Remove from workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Memoized: callbacks take the member instead of closing over it, so the
 * parent passes the same functions to every row and a row re-renders only
 * when its own member, permissions or busy flag change.
 */
const MemberRow = memo(function MemberRow({
  member,
  canManage,
  canManageOwners,
  isSelf,
  busy,
  onRoleChange,
  onRemove,
  onLinkGithub,
  onUnlinkGithub,
}: {
  member: MemberWithUser
  canManage: boolean
  canManageOwners: boolean
  isSelf: boolean
  busy: boolean
  onRoleChange: (member: MemberWithUser, role: MemberRole) => void
  onRemove: (member: MemberWithUser) => void
  onLinkGithub: (member: MemberWithUser) => void
  onUnlinkGithub: (member: MemberWithUser) => void
}) {
  const canEditRole =
    canManage && !isSelf && (member.role !== 'owner' || canManageOwners)
  const canRemove = canEditRole
  /**
   * Owner/admin only, own row included; an owner's row needs an owner, the
   * same rule as role edits (matches the API's 403s).
   */
  const canEditGithub =
    canManage && (member.role !== 'owner' || canManageOwners)

  return (
    <tr className="border-t border-border-default">
      <td className="px-4 py-4 sm:px-6">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-text-default">{member.name}</span>
          <span className="truncate text-text-secondary">{member.email}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-text-tertiary">
            <BrandGithubIcon className="size-3 shrink-0" />
            <span className="truncate">
              {githubIdentityStatusLabel(member)}
            </span>
          </span>
        </span>
      </td>
      <td className={TD_CLASS}>
        <Badge className={BADGE_CLASS[member.role]}>
          {roleConfig[member.role].label}
        </Badge>
      </td>
      {canManage ? (
        <td className="border-l border-border-default px-2 py-4 text-center">
          {canEditRole || canEditGithub ? (
            <MemberActions
              member={member}
              canEditRole={canEditRole}
              canEditGithub={canEditGithub}
              canRemove={canRemove}
              canManageOwners={canManageOwners}
              busy={busy}
              onRoleChange={(role) => onRoleChange(member, role)}
              onRemove={() => onRemove(member)}
              onLinkGithub={() => onLinkGithub(member)}
              onUnlinkGithub={() => onUnlinkGithub(member)}
            />
          ) : null}
        </td>
      ) : null}
    </tr>
  )
})

/**
 * Expired invites (pending status, past expiresAt) are told apart from live
 * ones so admins see why a link stopped working. Resend refreshes the same
 * invite instead of creating a duplicate row.
 */
const InvitationRow = memo(function InvitationRow({
  invitation,
  canManage,
  onRevoke,
  onResend,
  busy,
}: {
  invitation: Invitation
  canManage: boolean
  onRevoke: (invitation: Invitation) => void
  onResend: (invitation: Invitation) => void
  busy: boolean
}) {
  const expired = new Date(invitation.expiresAt).getTime() <= Date.now()

  return (
    <tr className="border-t border-border-default">
      <td className="truncate px-4 py-4 text-text-default sm:px-6">
        {invitation.email}
      </td>
      <td className={TD_CLASS}>
        <Badge className={BADGE_CLASS[invitation.role]}>
          {roleConfig[invitation.role].label}
        </Badge>
      </td>
      <td className={`${TD_CLASS} text-text-secondary`}>
        {expired ? 'Expired' : 'Pending'}
      </td>
      {canManage ? (
        <td className="border-l border-border-default px-2 py-4">
          <span className="flex items-center justify-center gap-1">
            <Button
              aria-label={`Resend invitation to ${invitation.email}`}
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={() => onResend(invitation)}
              title={expired ? 'Resend (extends expiry)' : 'Resend invitation'}
            >
              <SendHorizontal className="size-4 text-muted-foreground" />
            </Button>
            <Button
              aria-label={`Revoke invitation to ${invitation.email}`}
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={() => onRevoke(invitation)}
              title="Revoke invitation"
            >
              <X className="size-4 text-muted-foreground" />
            </Button>
          </span>
        </td>
      ) : null}
    </tr>
  )
})

const NO_MEMBERS: MemberWithUser[] = []

/**
 * Runs one member or invitation write, tracking its row as busy. A failure
 * toasts and rejects so an open confirm dialog stays open.
 */
async function runRowAction(
  setBusy: (id: string | null) => void,
  id: string,
  action: () => Promise<unknown>,
  fallback: string,
  onDone: () => void,
) {
  setBusy(id)
  const result = await Result.tryPromise({
    try: action,
    catch: (cause) => errorMessage(cause, fallback),
  })
  setBusy(null)
  return result.match({
    ok: () => onDone(),
    err: (message) => {
      toast.error(message)
      return Promise.reject(new Error(message))
    },
  })
}

type ConfirmAction = {
  title: string
  description: string
  confirmLabel: string
  pendingLabel: string
  onConfirm: () => Promise<void>
}

/**
 * Workspace members and pending invitations as tables, with the Add a Team
 * Member dialog for owners and admins. Per-member role, GitHub identity and
 * removal live in each row's ⋯ menu. `toolbar` fills the left of the action
 * row; Settings puts its sub-tab pills there.
 */
export function MembersTab({ toolbar }: { toolbar?: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const membersQuery = useQuery(memberListOptions(wsId))
  const members = membersQuery.data ?? NO_MEMBERS
  const { data: invitations = [] } = useQuery(invitationListOptions(wsId))

  const [memberActionId, setMemberActionId] = useState<string | null>(null)
  const [invitationActionId, setInvitationActionId] = useState<string | null>(
    null,
  )
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [githubTarget, setGithubTarget] = useState<MemberWithUser | null>(null)

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null
  const pendingInvitations = invitations.filter(
    (inv) => inv.status === 'pending',
  )
  const canManageWorkspace =
    currentMember?.role === 'owner' || currentMember?.role === 'admin'
  const isOwner = currentMember?.role === 'owner'

  const workspaceName = workspace?.name ?? 'this workspace'

  // Stable across renders so the memoized rows skip unrelated updates such as
  // a confirm dialog opening or another row going busy.
  const handleRevokeInvitation = useCallback(
    (invitation: Invitation) =>
      setConfirmAction({
        title: 'Revoke invitation',
        description: `Revoke the invitation to ${invitation.email}? They will no longer be able to join this workspace.`,
        confirmLabel: 'Revoke',
        pendingLabel: 'Revoking…',
        onConfirm: () =>
          runRowAction(
            setInvitationActionId,
            invitation.id,
            () => api.revokeInvitation(wsId, invitation.id),
            'Failed to revoke invitation',
            () => {
              void qc.invalidateQueries({
                queryKey: workspaceKeys.invitations(wsId),
              })
              toast.success('Invitation revoked')
            },
          ),
      }),
    [qc, wsId],
  )

  const handleResendInvitation = useCallback(
    (invitation: Invitation) =>
      void runRowAction(
        setInvitationActionId,
        invitation.id,
        () =>
          api.createMember(wsId, {
            email: invitation.email,
            role: invitation.role,
            resend: true,
          }),
        'Failed to resend invitation',
        () => {
          void qc.invalidateQueries({
            queryKey: workspaceKeys.invitations(wsId),
          })
          toast.success(`Invitation resent to ${invitation.email}`)
        },
      ).catch(() => undefined),
    [qc, wsId],
  )

  const handleRoleChange = useCallback(
    (member: MemberWithUser, role: MemberRole) =>
      void runRowAction(
        setMemberActionId,
        member.id,
        () => api.updateMember(wsId, member.id, { role }),
        'Failed to update member',
        () => {
          void qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) })
          toast.success('Role updated')
        },
      ).catch(() => undefined),
    [qc, wsId],
  )

  const handleRemoveMember = useCallback(
    (member: MemberWithUser) =>
      setConfirmAction({
        title: `Remove ${member.name}`,
        description: `Remove ${member.name} from ${workspaceName}? They will lose access to this workspace.`,
        confirmLabel: 'Remove',
        pendingLabel: 'Removing…',
        onConfirm: () =>
          runRowAction(
            setMemberActionId,
            member.id,
            () => api.deleteMember(wsId, member.id),
            'Failed to remove member',
            () => {
              void qc.invalidateQueries({
                queryKey: workspaceKeys.members(wsId),
              })
              toast.success('Member removed')
            },
          ),
      }),
    [qc, wsId, workspaceName],
  )

  const handleUnlinkGithub = useCallback(
    (member: MemberWithUser) =>
      setConfirmAction({
        title: `Unlink GitHub for ${member.name}`,
        description: `Remove the GitHub identity for ${member.name}? Mirrored GitHub issue assignment will show not linked until an owner or admin links it again.`,
        confirmLabel: 'Unlink',
        pendingLabel: 'Unlinking...',
        onConfirm: () =>
          runRowAction(
            setMemberActionId,
            member.id,
            () =>
              api.updateMember(wsId, member.id, {
                github_user_id: null,
                github_login: null,
              }),
            'Failed to unlink GitHub identity',
            () => {
              void qc.invalidateQueries({
                queryKey: workspaceKeys.members(wsId),
              })
              toast.success('GitHub identity unlinked')
            },
          ),
      }),
    [qc, wsId],
  )

  if (!workspace) return null

  return (
    <div className="flex flex-col gap-8">
      {toolbar || canManageWorkspace ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          {toolbar}
          {canManageWorkspace ? (
            <InviteMembersButton workspaceId={wsId} />
          ) : null}
        </div>
      ) : null}

      {membersQuery.isPending ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-label="Loading members"
        >
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : membersQuery.isError && members.length === 0 ? (
        <LoadError
          message="Could not load members."
          onRetry={() => void membersQuery.refetch()}
          retrying={membersQuery.isFetching}
        />
      ) : (
        <div className={TABLE_CLASS}>
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Workspace members</caption>
            <thead className={THEAD_CLASS}>
              <tr>
                <th className={`${TH_CLASS} text-left`}>User</th>
                <th
                  className={`${TH_CLASS} ${TH_DIVIDER} text-center w-32 sm:w-48`}
                >
                  Role
                </th>
                {canManageWorkspace ? (
                  <th className={`${TH_DIVIDER} w-14`}>
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className={TBODY_CLASS}>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canManageWorkspace}
                  canManageOwners={isOwner}
                  isSelf={m.user_id === user?.id}
                  busy={memberActionId === m.id}
                  onRoleChange={handleRoleChange}
                  onRemove={handleRemoveMember}
                  onLinkGithub={setGithubTarget}
                  onUnlinkGithub={handleUnlinkGithub}
                />
              ))}
              {members.length === 0 ? (
                <tr className="border-t border-border-default">
                  <td
                    colSpan={canManageWorkspace ? 3 : 2}
                    className="px-6 py-8 text-center text-text-secondary"
                  >
                    No members found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Pending invitations</h2>
          <div className={TABLE_CLASS}>
            <table className="w-full table-fixed text-sm">
              <thead className={THEAD_CLASS}>
                <tr>
                  <th className={`${TH_CLASS} text-left`}>Email</th>
                  <th
                    className={`${TH_CLASS} ${TH_DIVIDER} text-center w-28 sm:w-36`}
                  >
                    Role
                  </th>
                  <th
                    className={`${TH_CLASS} ${TH_DIVIDER} text-center w-28 sm:w-36`}
                  >
                    Status
                  </th>
                  {canManageWorkspace ? (
                    <th className={`${TH_DIVIDER} w-24`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className={TBODY_CLASS}>
                {pendingInvitations.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    canManage={canManageWorkspace}
                    onRevoke={handleRevokeInvitation}
                    onResend={handleResendInvitation}
                    busy={invitationActionId === inv.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {githubTarget ? (
        <GithubIdentityLinkDialog
          key={githubTarget.id}
          open
          onOpenChange={(open) => {
            if (!open) setGithubTarget(null)
          }}
          workspaceId={wsId}
          member={githubTarget}
          onSaved={() =>
            void qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) })
          }
        />
      ) : null}

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        title={confirmAction?.title}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        pendingLabel={confirmAction?.pendingLabel}
        tone="destructive"
        onConfirm={() =>
          confirmAction ? confirmAction.onConfirm() : Promise.resolve()
        }
      />
    </div>
  )
}
