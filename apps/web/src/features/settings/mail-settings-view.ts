/**
 * Derived from OpenShip
 * `apps/dashboard/src/app/(dashboard)/emails/_lib/view-gate.ts` at commit
 * 738946188e7c329477a4bbcf9c58dc1451393798 (Apache-2.0).
 *
 * Modified for Garden: the controller already owns loading, unavailable, and
 * error states, so this gate only chooses between the two mutually exclusive
 * views available once mail settings are ready.
 */

import type { ActiveMailSettingsController } from './mail-settings-controller'

export type MailSettingsView = 'setup' | 'admin'

/**
 * Selects the ready mail-settings surface from canonical transport state.
 * Imported provider mailboxes are valid without a Garden-owned domain, so an
 * existing mailbox enters administration while a completely empty workspace
 * keeps OpenShip's setup flow.
 */
export function resolveMailSettingsView(
  controller: Pick<ActiveMailSettingsController, 'domains' | 'mailboxes'>,
): MailSettingsView {
  return controller.domains.length === 0 && controller.mailboxes.length === 0
    ? 'setup'
    : 'admin'
}
