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
 * Selects the ready mail-settings surface from canonical domain state. Before
 * this gate, consumers could independently infer setup state and drift; now a
 * ready controller with no domain always enters setup and any domain enters
 * administration. Source: OpenShip's pure mail view gate, adapted to Garden's
 * domain-backed controller.
 */
export function resolveMailSettingsView(
  controller: Pick<ActiveMailSettingsController, 'domains'>,
): MailSettingsView {
  return controller.domains.length === 0 ? 'setup' : 'admin'
}
