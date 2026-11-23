import { useState, type ReactNode } from 'react'
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
import { InviteMembersDialog } from './invite-members-dialog'

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

const TABLE_CLASS =
  'overflow-hidden rounded-2xl border border-border-default bg-background-main-default'
const TH_CLASS = 'px-4 py-4 text-center font-semibold text-text-default sm:px-6'
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

function MemberRow({
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
  onRoleChange: (role: MemberRole) => void
  onRemove: () => void
  onLinkGithub: () => void
  onUnlinkGithub: () => void
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
              onRoleChange={onRoleChange}
              onRemove={onRemove}
              onLinkGithub={onLinkGithub}
              onUnlinkGithub={onUnlinkGithub}
            />
          ) : null}
        </td>
      ) : null}
    </tr>
  )
}

/**
 * Expired invites (pending status, past expiresAt) are told apart from live
 * ones so admins see why a link stopped working. Resend refreshes the same
 * invite instead of creating a duplicate row.
 */
function InvitationRow({
  invitation,
  canManage,
  onRevoke,
  onResend,
  busy,
}: {
  invitation: Invitation
  canManage: boolean
  onRevoke: () => void
  onResend: () => void
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
              onClick={onResend}
              title={expired ? 'Resend (extends expiry)' : 'Resend invitation'}
            >
              <SendHorizontal className="size-4 text-muted-foreground" />
            </Button>
            <Button
              aria-label={`Revoke invitation to ${invitation.email}`}
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={onRevoke}
              title="Revoke invitation"
            >
              <X className="size-4 text-muted-foreground" />
            </Button>
          </span>
        </td>
      ) : null}
    </tr>
  )
}

const NO_MEMBERS: MemberWithUser[] = []

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

  const [inviteOpen, setInviteOpen] = useState(false)
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

  const invalidateMembers = () =>
    qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) })
  const invalidateInvitations = () =>
    qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) })

  /**
   * Runs one member or invitation write, tracking its row as busy. A failure
   * toasts and rejects so an open confirm dialog stays open.
   */
  const runAction = async (
    setBusy: (id: string | null) => void,
    id: string,
    action: () => Promise<unknown>,
    fallback: string,
    onDone: () => void,
  ) => {
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

  const handleRevokeInvitation = (invitation: Invitation) =>
    setConfirmAction({
      title: 'Revoke invitation',
      description: `Revoke the invitation to ${invitation.email}? They will no longer be able to join this workspace.`,
      confirmLabel: 'Revoke',
      pendingLabel: 'Revoking…',
      onConfirm: () =>
        runAction(
          setInvitationActionId,
          invitation.id,
          () => api.revokeInvitation(wsId, invitation.id),
          'Failed to revoke invitation',
          () => {
            void invalidateInvitations()
            toast.success('Invitation revoked')
          },
        ),
    })

  const handleResendInvitation = (invitation: Invitation) =>
    void runAction(
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
        void invalidateInvitations()
        toast.success(`Invitation resent to ${invitation.email}`)
      },
    ).catch(() => undefined)

  const handleRoleChange = (memberId: string, role: MemberRole) =>
    void runAction(
      setMemberActionId,
      memberId,
      () => api.updateMember(wsId, memberId, { role }),
      'Failed to update member',
      () => {
        void invalidateMembers()
        toast.success('Role updated')
      },
    ).catch(() => undefined)

  const handleRemoveMember = (member: MemberWithUser) =>
    setConfirmAction({
      title: `Remove ${member.name}`,
      description: `Remove ${member.name} from ${workspace?.name ?? 'this workspace'}? They will lose access to this workspace.`,
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      onConfirm: () =>
        runAction(
          setMemberActionId,
          member.id,
          () => api.deleteMember(wsId, member.id),
          'Failed to remove member',
          () => {
            void invalidateMembers()
            toast.success('Member removed')
          },
        ),
    })

  const handleUnlinkGithub = (member: MemberWithUser) =>
    setConfirmAction({
      title: `Unlink GitHub for ${member.name}`,
      description: `Remove the GitHub identity for ${member.name}? Mirrored GitHub issue assignment will show not linked until an owner or admin links it again.`,
      confirmLabel: 'Unlink',
      pendingLabel: 'Unlinking...',
      onConfirm: () =>
        runAction(
          setMemberActionId,
          member.id,
          () =>
            api.updateMember(wsId, member.id, {
              github_user_id: null,
              github_login: null,
            }),
          'Failed to unlink GitHub identity',
          () => {
            void invalidateMembers()
            toast.success('GitHub identity unlinked')
          },
        ),
    })

  if (!workspace) return null

  return (
    <div className="flex flex-col gap-8">
      {toolbar || canManageWorkspace ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          {toolbar}
          {canManageWorkspace ? (
            <Button
              className="ml-auto h-10 rounded-md px-3"
              onClick={() => setInviteOpen(true)}
            >
              Add a Team Member
            </Button>
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
            <thead>
              <tr className="bg-background-main-secondary">
                <th className={TH_CLASS}>User</th>
                <th className={`${TH_CLASS} w-32 sm:w-48`}>Role</th>
                {canManageWorkspace ? (
                  <th className="w-14">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canManageWorkspace}
                  canManageOwners={isOwner}
                  isSelf={m.user_id === user?.id}
                  busy={memberActionId === m.id}
                  onRoleChange={(role) => handleRoleChange(m.id, role)}
                  onRemove={() => handleRemoveMember(m)}
                  onLinkGithub={() => setGithubTarget(m)}
                  onUnlinkGithub={() => handleUnlinkGithub(m)}
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
              <thead>
                <tr className="bg-background-main-secondary">
                  <th className={TH_CLASS}>Email</th>
                  <th className={`${TH_CLASS} w-28 sm:w-36`}>Role</th>
                  <th className={`${TH_CLASS} w-28 sm:w-36`}>Status</th>
                  {canManageWorkspace ? (
                    <th className="w-24">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    canManage={canManageWorkspace}
                    onRevoke={() => handleRevokeInvitation(inv)}
                    onResend={() => handleResendInvitation(inv)}
                    busy={invitationActionId === inv.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inviteOpen ? (
        <InviteMembersDialog
          workspaceId={wsId}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      {githubTarget ? (
        <GithubIdentityLinkDialog
          key={githubTarget.id}
          open
          onOpenChange={(open) => {
            if (!open) setGithubTarget(null)
          }}
          workspaceId={wsId}
          member={githubTarget}
          onSaved={() => void invalidateMembers()}
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
