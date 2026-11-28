---
title: Architecture diagrams show how Garden's parts connect
description: Draw.io diagrams of Garden's components, runtime, runs, issues, automations, deployment, connector access, and host protocol, and how to edit them.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-28
---

These diagrams show Garden's moving parts in one picture each. Each diagram lives in `docs/diagrams/` as a `.drawio.svg` file, so it renders on GitHub and here and still opens in draw.io. The date line on each diagram names the Garden commit it was last checked against.

## Components

This diagram answers which services, workflows, and Durable Objects handle a member's request, and where authority is checked. Read [agent runtime](./agent-runtime.md) and [how Garden is built](./how-garden-is-built.mdx) for the detail.

![Garden components](../../diagrams/garden-components.drawio.svg)

## Deployment and storage

This diagram answers where Garden's code runs and which store holds each kind of state. The bindings it names come from `apps/web/wrangler.jsonc`. Read [how Garden is built](./how-garden-is-built.mdx) for the full list.

![Garden deployment and storage](../../diagrams/garden-deployment.drawio.svg)

## Issue run and retained context

This diagram answers how a run keeps its submission and Brain history safe across retries and resumes. Read [run engine](./run-engine.md) and [issues](../features/issues.md) for the run lifecycle.

![Garden issue run](../../diagrams/garden-issue-run.drawio.svg)

## Member connector access

This diagram answers how one member connects WorkStream through OAuth without touching another member's connection. Read [connectors](./connectors.md) and [WorkStream](../features/workstream.md).

![Garden member connector access](../../diagrams/garden-member-connector.drawio.svg)

## Host launch protocol (proposed, not merged)

This diagram answers why a launch receipt alone cannot start a worker on an execution host. It is a proposal. The Garden receiver it shows is in pull request #413 and is not on `dev`. Read [execution runtimes](./execution-runtimes.md) and the [execution host contract](../../proposals/execution-host-contract.md).

![Garden host launch protocol](../../diagrams/garden-host-launch.drawio.svg)

## Host intervention and recovery (proposed, not merged)

This diagram answers how a host applies a person's answer exactly once and recovers when it is unsure a process stopped. It is a proposal. Its Garden side is on the unmerged `feat/engineering-host-interventions` branch and is not on `dev`. Read the [execution host contract](../../proposals/execution-host-contract.md).

![Garden host intervention and recovery](../../diagrams/garden-host-intervention.drawio.svg)

## Garden overview

This diagram answers which parts make up Garden and what calls what, from the browser to the stores. It sits on [how Garden is built](./how-garden-is-built.mdx).

![Garden overview](../../diagrams/garden-overview.drawio.svg)

## AgentDO and its Think facets

This diagram answers how one `AgentDO` creates a Think facet for each chat, run, and Brain pass, and how each facet is keyed. It sits on [agent runtime](./agent-runtime.md).

![AgentDO and its Think facets](../../diagrams/agent-runtime.drawio.svg)

## RunWorkflow turn loop

This diagram answers how `RunWorkflow` submits a turn, waits for it, and then retries, waits for a person, resumes, or cancels. It sits on [run engine](./run-engine.md).

![RunWorkflow turn loop](../../diagrams/run-engine-turns.drawio.svg)

## Run states

This diagram answers which statuses an `issue_run` and an `automation_run` move through, and which code writes each one. It sits on [run engine](./run-engine.md).

![Run states](../../diagrams/run-states.drawio.svg)

## Issue and issue run states

This diagram answers how an issue's status relates to the statuses of its runs. It sits on [issues](../features/issues.md).

![Issue and issue run states](../../diagrams/issue-states.drawio.svg)

## Work product review flow

This diagram answers what happens when a reviewer approves, requests changes, applies, or applies a work product as a pull request. It sits on [issues](../features/issues.md).

![Work product review flow](../../diagrams/work-product-flow.drawio.svg)

## Automation run

This diagram answers how a scheduled or manual trigger becomes one automation run and where its output is stored. It sits on [automations](../features/automations.md).

![Automation run](../../diagrams/automation-run.drawio.svg)

## Permission decision

This diagram answers when an agent tool call runs, asks a person, or is refused. It sits on [permissions](../features/permissions.md).

![Permission decision](../../diagrams/permission-decision.drawio.svg)

## Brain flow

This diagram answers how knowledge enters the Brain, goes to review, and is read back by agents. It sits on [Brain](./brain.md).

![Brain flow](../../diagrams/brain-flow.drawio.svg)

## Connector call path

This diagram answers how an agent call reaches an outside service through Executor. It sits on [connectors](./connectors.md).

![Connector call path](../../diagrams/connectors.drawio.svg)

## Realtime paths

This diagram answers how a write reaches other browsers, and how chat and runs take their own path. It sits on [realtime](./realtime.md).

![Realtime paths](../../diagrams/realtime.drawio.svg)

## One chat turn

This diagram answers how one chat message reaches its facet and how the reply comes back. It sits on [chat](../features/chat.md).

![One chat turn](../../diagrams/chat-turn.drawio.svg)

## Execution runtimes

This diagram answers which runtime runs which kind of agent code. It sits on [execution runtimes](./execution-runtimes.md).

![Execution runtimes](../../diagrams/execution-runtimes.drawio.svg)

## Edit a diagram

1. Open the `.drawio.svg` file in draw.io desktop, app.diagrams.net, or the VS Code Draw.io Integration extension. An agent can instead edit the draw.io XML embedded in the file and run `pnpm diagrams:export` to redraw the picture.
2. Make the change, update the "checked against" commit on the date line, and save. Keep the file name and the `.drawio.svg` extension.
3. Run `pnpm verify:diagrams`, then commit the file in the same pull request as the code change.

`docs/diagrams/manifest.json` maps each diagram to the code paths it describes. A pull request that changes one of those paths must update the diagram or add `Diagrams: not affected (<name>) — <reason>` for it. See [Pull request contract](../../reference/pr-contract.mdx).
