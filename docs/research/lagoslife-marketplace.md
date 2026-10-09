# LagosLife marketplace evaluation environment

First build milestone for Flow Research's LagosLife programme: a deterministic,
in-memory marketplace with typed actions and independent outcome verification.
Import through `@garden/core/evaluation/marketplace`.

This is a mock research environment. It does not connect to LagosLife, run a
model, authenticate HTTP requests, persist episodes or create Garden automations.
No new dependency, database migration or deployed route is required.

## Run the checks

From the Garden workspace after its normal dependency installation:

```sh
pnpm --filter @garden/core test -- src/evaluation/marketplace/marketplace.test.ts
pnpm --filter @garden/core typecheck
pnpm --filter @garden/core lint
```

The tests include the complete scripted purchase, cancellation and refunds,
competing quotes, stale state, denied actions, duplicate actions, late delivery,
observation isolation, resets and tampered evidence.

## Public contract

| Function | Purpose |
| --- | --- |
| `createMarketplace(config, episodeId)` | Validate a scenario and create a fresh snapshot. |
| `observeMarketplace(snapshot, actor)` | Return the actor's own account, visible inventory and relevant commitments. |
| `applyMarketplaceAction(snapshot, actor, input)` | Validate an action, return a transaction receipt and a new snapshot. |
| `advanceMarketplaceClock(snapshot, nextTick)` | Advance the scenario clock from the trusted runner. |
| `verifyMarketplace(initial, final, goal)` | Replay receipts from the original world and score the independent task goal. |

Actions and scenario inputs use shared strict Zod schemas. Domain refusals return
`Result.ok` with a `rejected` receipt and a concrete reason. Malformed inputs,
cross-episode scope and conflicting replay IDs return typed `Result.err` values.
Handle both branches at the adapter boundary with `.match()`.

### Identity and observations

Resolve `MarketplaceActor.characterId` from an authenticated Garden character
binding outside the agent payload. The action schema refuses extra identity
fields. This library trusts the caller to establish that binding; a string passed
to this library is not authentication.

Agents receive observations, not full snapshots or the receipt ledger. Buyers
can see the catalogue; shopkeepers see their inventory; couriers see available
accepted jobs and jobs assigned to them. Other characters' balances and policies
are omitted. Keep the complete world and initial snapshot in the trusted runner.

### Transactions

`create_quote` → `accept_order` → `accept_delivery` → `deliver_order`

Quotes do not reserve stock. Acceptance checks the current stock, balance,
recipient allowlist and cumulative spending limit, then reserves stock and holds
the goods price plus delivery fee in escrow. Delivery settles the seller and
assigned courier. The mock's authorised `deliver_order` transition represents
delivery evidence; a real adapter must replace that assumption with game-side
delivery validation.

The buyer, seller or assigned courier can cancel before delivery. Cancellation
releases stock and refunds escrow. Spending limits count cumulative commitments
in an episode; refunds do not replenish that limit. Completed deliveries cannot
be cancelled. Monetary values are integer minor units in one test currency.

Deadlines are inclusive. Acceptance and assignment after the deadline are
rejected. Late delivery is recorded and settled, but fails the deadline goal.
Only the trusted runner advances time. Transaction revisions count applied
actions, while the clock is recorded independently in receipts.

### Replay and storage

An `actionId` is unique within an episode. The same validated payload and actor
return the original receipt, including refusals, without repeating changes.
Changing the payload or actor under that ID is an error. A stale revision is a
recorded refusal; a subsequent attempt after refreshing state needs a new ID.

Every call copies its input world. The returned snapshot is the complete new
state, including its receipt. For this milestone a single synchronous owner
serialises actions. Before a persisted or remote adapter is introduced, commit
the revision check, world changes and receipt together under one transaction or
single-owner boundary. This pure function alone does not prevent two remote
writers from applying competing snapshots.

### Verification and evaluation evidence

Hold the task goal separately from agent requests. Verify buyer, seller,
recipient, item, quantity, cumulative expenditure, deadline and resolution of
accepted commitments. Replay each receipt to reconstruct the expected world;
altered balances, invented delivery state and incomplete receipts fail.

Receipts are trusted mock-environment records, not cryptographically attested
evidence. Verification detects changes inconsistent with those records; it cannot
establish authenticity if an attacker controls the initial world and whole ledger.
Keep both outside the agent's write scope.

Metrics include applied and rejected actions, unresolved commitments, spend and
completion tick. Preserve unsuccessful episodes too. These records are candidate
evaluation evidence; they do not yet constitute a training or commercial dataset.

## Next implementation boundary

1. Review these contracts and transaction semantics with the LagosLife team.
2. Add Garden's canonical typed automation template and role instructions. Bind
   observe/action tools through Garden's existing permission gateway.
3. Add the shopkeeper and courier agent runs in the mock environment. Human
   acceptance remains explicit until approval waiting and resumption are tested.
4. Persist immutable episode configuration, runtime/model versions and evidence;
   leave durable execution, wait, resume and cancellation with RunWorkflow.
5. Add authenticated event ingress and a LagosLife sandbox adapter once partner
   interfaces are agreed. Add external runtimes through the same governed tools.

Ambiguity, deceptive messages, provider failures and human intervention need the
agent-driven scenario layer; they are not measured by the scripted transaction
tests. Publication, in-house training and licensing require separately established
rights and a later dataset curation pipeline.
