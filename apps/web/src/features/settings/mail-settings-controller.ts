import { Result, type Result as BetterResult } from 'better-result'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type {
  CreateMailAddressSettingsInput,
  CreateMailboxSettingsInput,
  MailboxSettingsView,
  MailDomainSettingsView,
  MailSettingsActorView,
  RegisterMailDomainSettingsInput,
  SetMailboxAccessSettingsInput,
} from './mail-settings-contracts'
import {
  createAddress,
  createMailbox,
  mailSettingsKeys,
  mailSettingsOptions,
  refreshDomain,
  registerDomain,
  removeAccess,
  setAccess,
} from './mail-settings.queries'

export type {
  CreateMailAddressSettingsInput,
  CreateMailboxSettingsInput,
  MailAddressSettingsView,
  MailboxAccessSettingsView,
  MailboxSettingsView,
  MailDomainSettingsView,
  MailSettingsActorView,
  RegisterMailDomainSettingsInput,
  SetMailboxAccessSettingsInput,
} from './mail-settings-contracts'

export type MailSettingsCommandOutcome =
  | { kind: 'domain_registered'; domainId: string }
  | { kind: 'domain_refreshed'; domainId: string }
  | { kind: 'mailbox_created'; mailboxId: string }
  | { kind: 'address_created'; addressId: string }
  | { kind: 'access_set'; accessId: string }
  | { kind: 'access_removed'; accessId: string }

export type MailSettingsCommandError = {
  message: string
  field?: string
}

export type MailSettingsCommand = Promise<
  BetterResult<MailSettingsCommandOutcome, MailSettingsCommandError>
>

export type MailSettingsPendingAction =
  | { kind: 'register_domain' }
  | { kind: 'refresh_domain'; domainId: string }
  | { kind: 'create_mailbox' }
  | { kind: 'create_address'; mailboxId: string }
  | { kind: 'set_access'; mailboxId: string; actorId: string }
  | { kind: 'remove_access'; accessId: string }

export type ActiveMailSettingsController = {
  status: 'ready'
  canManage: boolean
  domains: MailDomainSettingsView[]
  mailboxes: MailboxSettingsView[]
  actors: MailSettingsActorView[]
  pendingAction: MailSettingsPendingAction | null
  actions: {
    registerDomain: (
      input: RegisterMailDomainSettingsInput,
    ) => MailSettingsCommand
    refreshDomain: (domainId: string) => MailSettingsCommand
    createMailbox: (input: CreateMailboxSettingsInput) => MailSettingsCommand
    createAddress: (
      input: CreateMailAddressSettingsInput,
    ) => MailSettingsCommand
    setAccess: (input: SetMailboxAccessSettingsInput) => MailSettingsCommand
    removeAccess: (accessId: string) => MailSettingsCommand
  }
}

export type MailSettingsController =
  | { status: 'unavailable'; reason: string }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | ActiveMailSettingsController

/** Preserves a useful server/Effect message without exposing unknown payloads. */
function commandError(cause: unknown): MailSettingsCommandError {
  if (cause instanceof Error) return { message: cause.message }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    return { message: cause.message }
  }
  return { message: 'Garden Mail could not complete this operation.' }
}

/** Converts one rejecting server mutation into the controller's Result command. */
async function runCommand<A>(
  execute: () => Promise<A>,
  outcome: (value: A) => MailSettingsCommandOutcome,
): MailSettingsCommand {
  return (
    await Result.tryPromise({
      try: execute,
      catch: commandError,
    })
  ).map(outcome)
}

/**
 * Authenticated Query/controller adapter for Garden Mail administration. All
 * actor identity and administrator authority comes from the server projection;
 * successful commands invalidate the single workspace aggregate.
 */
export function useMailSettingsController(
  workspaceId: string,
): MailSettingsController {
  const queryClient = useQueryClient()
  const snapshot = useQuery(mailSettingsOptions(workspaceId))
  const registerDomainFn = useServerFn(registerDomain)
  const refreshDomainFn = useServerFn(refreshDomain)
  const createMailboxFn = useServerFn(createMailbox)
  const createAddressFn = useServerFn(createAddress)
  const setAccessFn = useServerFn(setAccess)
  const removeAccessFn = useServerFn(removeAccess)
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: mailSettingsKeys.all(workspaceId),
    })

  const registerDomainMutation = useMutation({
    mutationFn: (input: RegisterMailDomainSettingsInput) =>
      registerDomainFn({ data: { workspaceId, ...input } }),
    onSuccess: invalidate,
  })
  const refreshDomainMutation = useMutation({
    mutationFn: (domainId: string) =>
      refreshDomainFn({ data: { workspaceId, domainId } }),
    onSuccess: invalidate,
  })
  const createMailboxMutation = useMutation({
    mutationFn: (input: CreateMailboxSettingsInput) =>
      createMailboxFn({ data: { workspaceId, ...input } }),
    onSuccess: invalidate,
  })
  const createAddressMutation = useMutation({
    mutationFn: (input: CreateMailAddressSettingsInput) =>
      createAddressFn({ data: { workspaceId, ...input } }),
    onSuccess: invalidate,
  })
  const setAccessMutation = useMutation({
    mutationFn: (input: SetMailboxAccessSettingsInput) =>
      setAccessFn({ data: { workspaceId, ...input } }),
    onSuccess: invalidate,
  })
  const removeAccessMutation = useMutation({
    mutationFn: (accessId: string) =>
      removeAccessFn({ data: { workspaceId, accessId } }),
    onSuccess: invalidate,
  })

  if (snapshot.isPending) return { status: 'loading' }
  if (snapshot.isError) {
    return {
      status: 'error',
      message: commandError(snapshot.error).message,
      retry: () => {
        void snapshot.refetch()
      },
    }
  }

  const pendingAction: MailSettingsPendingAction | null =
    registerDomainMutation.isPending
      ? { kind: 'register_domain' }
      : refreshDomainMutation.isPending
        ? {
            kind: 'refresh_domain',
            domainId: refreshDomainMutation.variables,
          }
        : createMailboxMutation.isPending
          ? { kind: 'create_mailbox' }
          : createAddressMutation.isPending
            ? {
                kind: 'create_address',
                mailboxId: createAddressMutation.variables.mailboxId,
              }
            : setAccessMutation.isPending
              ? {
                  kind: 'set_access',
                  mailboxId: setAccessMutation.variables.mailboxId,
                  actorId: setAccessMutation.variables.actor.id,
                }
              : removeAccessMutation.isPending
                ? {
                    kind: 'remove_access',
                    accessId: removeAccessMutation.variables,
                  }
                : null

  return {
    status: 'ready',
    ...snapshot.data,
    pendingAction,
    actions: {
      registerDomain: (input) =>
        runCommand(
          () => registerDomainMutation.mutateAsync(input),
          (domainId) => ({ kind: 'domain_registered', domainId }),
        ),
      refreshDomain: (domainId) =>
        runCommand(
          () => refreshDomainMutation.mutateAsync(domainId),
          (refreshedDomainId) => ({
            kind: 'domain_refreshed',
            domainId: refreshedDomainId,
          }),
        ),
      createMailbox: (input) =>
        runCommand(
          () => createMailboxMutation.mutateAsync(input),
          (mailboxId) => ({ kind: 'mailbox_created', mailboxId }),
        ),
      createAddress: (input) =>
        runCommand(
          () => createAddressMutation.mutateAsync(input),
          (addressId) => ({ kind: 'address_created', addressId }),
        ),
      setAccess: (input) =>
        runCommand(
          () => setAccessMutation.mutateAsync(input),
          (accessId) => ({ kind: 'access_set', accessId }),
        ),
      removeAccess: (accessId) =>
        runCommand(
          () => removeAccessMutation.mutateAsync(accessId),
          (removedAccessId) => ({
            kind: 'access_removed',
            accessId: removedAccessId,
          }),
        ),
    },
  }
}
