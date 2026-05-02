'use client'

import { useState } from 'react'
import {
  Crown,
  Shield,
  User,
  Plus,
  MoreHorizontal,
  UserMinus,
  Clock,
  X,
  Mail,
} from 'lucide-react'
import { ActorAvatar } from '../../common/actor-avatar'
import type {
  MemberWithUser,
  MemberRole,
  Invitation,
} from '@garden/core/types'
import { Input } from '@garden/ui/components/ui/input'
import { Button } from '@garden/ui/components/ui/button'
import { Badge } from '@garden/ui/components/ui/badge'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@garden/ui/components/ui/alert-dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@garden/ui/components/ui/select'
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
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  memberListOptions,
  invitationListOptions,
  workspaceKeys,
} from '@garden/core/workspace/queries'
import { api } from '@/lib/api'

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

function MemberRow({
  member,
  canManage,
  canManageOwners,
  isSelf,
  busy,
  onRoleChange,
  onRemove,
}: {
  member: MemberWithUser
  canManage: boolean
  canManageOwners: boolean
  isSelf: boolean
  busy: boolean
  onRoleChange: (role: MemberRole) => void
  onRemove: () => void
}) {
  const rc = roleConfig[member.role]
  const RoleIcon = rc.icon
  const canEditRole =
    canManage && !isSelf && (member.role !== 'owner' || canManageOwners)
  const canRemove =
    canManage && !isSelf && (member.role !== 'owner' || canManageOwners)
  const showMenu = canEditRole || canRemove

  return (
    <li className="flex items-center gap-3 py-3">
      <ActorAvatar actorType="member" actorId={member.user_id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{member.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {member.email}
        </div>
      </div>
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" disabled={busy}>
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            {canEditRole && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Shield className="h-3.5 w-3.5" />
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
                        <Icon className="h-3.5 w-3.5" />
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
            {canEditRole && canRemove && <DropdownMenuSeparator />}
            {canRemove && (
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <UserMinus className="h-3.5 w-3.5" />
                Remove from workspace
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Badge variant="secondary">
        <RoleIcon className="h-3 w-3" />
        {rc.label}
      </Badge>
    </li>
  )
}

function InvitationRow({
  invitation,
  canManage,
  onRevoke,
  busy,
}: {
  invitation: Invitation
  canManage: boolean
  onRevoke: () => void
  busy: boolean
}) {
  const rc = roleConfig[invitation.role]

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        <Mail className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invitation.email}</div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Pending</span>
        </div>
      </div>
      {canManage && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={onRevoke}
          title="Revoke invitation"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
      <Badge variant="outline">{rc.label}</Badge>
    </li>
  )
}

export function MembersTab() {
  const user = useAuthStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const { data: invitations = [] } = useQuery(invitationListOptions(wsId))

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('member')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [memberActionId, setMemberActionId] = useState<string | null>(null)
  const [invitationActionId, setInvitationActionId] = useState<string | null>(
    null,
  )
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    variant?: 'destructive'
    onConfirm: () => Promise<void>
  } | null>(null)

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null
  const pendingInvitations = invitations.filter(
    (inv) => inv.status === 'pending',
  )
  const canManageWorkspace =
    currentMember?.role === 'owner' || currentMember?.role === 'admin'
  const isOwner = currentMember?.role === 'owner'

  const handleInviteMember = async () => {
    if (!workspace) return
    setInviteLoading(true)
    try {
      await api.createMember(workspace.id, {
        email: inviteEmail,
        role: inviteRole,
      })
      setInviteEmail('')
      setInviteRole('member')
      qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) })
      toast.success('Invitation sent')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRevokeInvitation = (invitation: Invitation) => {
    if (!workspace) return
    setConfirmAction({
      title: 'Revoke invitation',
      description: `Revoke the invitation to ${invitation.email}? They will no longer be able to join this workspace.`,
      variant: 'destructive',
      onConfirm: async () => {
        setInvitationActionId(invitation.id)
        try {
          await api.revokeInvitation(workspace.id, invitation.id)
          qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) })
          toast.success('Invitation revoked')
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : 'Failed to revoke invitation',
          )
        } finally {
          setInvitationActionId(null)
        }
      },
    })
  }

  const handleRoleChange = async (memberId: string, role: MemberRole) => {
    if (!workspace) return
    setMemberActionId(memberId)
    try {
      await api.updateMember(workspace.id, memberId, { role })
      qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) })
      toast.success('Role updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update member')
    } finally {
      setMemberActionId(null)
    }
  }

  const handleRemoveMember = (member: MemberWithUser) => {
    if (!workspace) return
    setConfirmAction({
      title: `Remove ${member.name}`,
      description: `Remove ${member.name} from ${workspace.name}? They will lose access to this workspace.`,
      variant: 'destructive',
      onConfirm: async () => {
        setMemberActionId(member.id)
        try {
          await api.deleteMember(workspace.id, member.id)
          qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) })
          toast.success('Member removed')
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : 'Failed to remove member',
          )
        } finally {
          setMemberActionId(null)
        }
      },
    })
  }

  if (!workspace) return null

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <header>
          <h2 className="text-base font-semibold">
            Members{' '}
            <span className="font-normal text-muted-foreground">
              ({members.length})
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            People with access to this workspace.
          </p>
        </header>

        {canManageWorkspace && (
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@company.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inviteEmail.trim())
                  handleInviteMember()
              }}
            />
            <Select
              value={inviteRole}
              onValueChange={(value) => setInviteRole(value as MemberRole)}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleInviteMember}
              disabled={inviteLoading || !inviteEmail.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
              {inviteLoading ? 'Inviting...' : 'Invite'}
            </Button>
          </div>
        )}

        {members.length > 0 ? (
          <ul className="divide-y border-t">
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
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No members found.</p>
        )}
      </section>

      {pendingInvitations.length > 0 && (
        <section className="space-y-5">
          <header>
            <h2 className="text-base font-semibold">
              Pending invitations{' '}
              <span className="font-normal text-muted-foreground">
                ({pendingInvitations.length})
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Invitations that haven't been accepted yet.
            </p>
          </header>
          <ul className="divide-y border-t">
            {pendingInvitations.map((inv) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                canManage={canManageWorkspace}
                onRevoke={() => handleRevokeInvitation(inv)}
                busy={invitationActionId === inv.id}
              />
            ))}
          </ul>
        </section>
      )}

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(v) => {
          if (!v) setConfirmAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.variant === 'destructive'
                  ? 'destructive'
                  : 'default'
              }
              onClick={async () => {
                await confirmAction?.onConfirm()
                setConfirmAction(null)
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
