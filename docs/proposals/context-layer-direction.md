---
title: Context layer and Flow Research onboarding
description: Product direction agreed on 2026-11-06 for turning Org Brain into a team-aware context layer, onboarding every Flow Research team, and using meetings as the first shared source of context.
status: proposal
owner: "@Umoren"
last_reviewed: 2026-11-06
---

**Date:** 2026-11-06. **Audience:** the Garden team and any agent working on Org Brain, meetings, Teams, or onboarding.

> **Not built.** This page records direction, not shipped behavior. The Org Brain rebuild described below sits on the local branch `feat/org-brain-memory` and is not merged into `dev`.

## 1. Where this came from

The Product & Engineering Sync on 2026-11-05 (Garden, Workstream, Research Platform) named the problem plainly. Garden's Org Brain stores data but gives nobody a reason to open it. The task board goes unused, GitHub issue sync is broken, and the team itself reaches for Claude instead of Garden's chat. If Garden is not useful to Flow Research, it is not ready for anyone else.

The meeting settled three things. Org Brain becomes a dynamic context layer instead of a static store. Flow Research uses Garden internally before Garden seeks outside customers. Workstream moved to an API-first model, so Garden no longer waits on a Workstream SDK.

Samuel described the context layer in that meeting as a visualizer that distributes relevant information across departmental workspaces. That sentence is the product.

## 2. The goal

Every Flow Research team works on Garden, and Flow Research is built on Garden. Garden agents carry out work as tasks. The context layer brings each team the knowledge that matters to it, at the moment it matters, without anyone searching for it.

The test of success is behavioral. People open their team's Garden page instead of asking in Discord, and the team stops defaulting to a general chat assistant because Garden knows Flow Research and the assistant does not.

## 3. What we learned from Grok Bot

xAI's Grok Bot is the closest model for the agent half of this vision. It launched on 2026-08-11 and added Team Bots on 2026-09-28. Like Garden, it started as a tool xAI's own teams used internally.

Grok Bot gives each role its own bot and puts a coordinating "chief of staff" above them. Its templates map to departments: sales, product, marketing, and data. A bot can watch a task once and save it as a routine. A process that works becomes a skill with steps, decision rules, expected output, and approval points. Bots run on a persistent cloud machine, hand work to each other in small group chats, and return to a human only when approval is needed.

Its weak point is shared knowledge. Context lives in per-bot memory, in files people maintain by hand, and in skills. Nothing builds an organization's knowledge automatically. That gap is where Org Brain fits, and it is why Garden can be more than a copy.

What we take from Grok Bot:

- One agent per team, scoped to that team's work.
- Routines and skills as the unit of repeatable work.
- Agents report back for approval instead of asking for direction at every step.
- Private personal chats, shared team skills and knowledge.

## 4. What we learned from NVIDIA Auto Ontology

NVIDIA's Auto Ontology (open source, Apache-2.0, `github.com/NVIDIA/auto-ontology`) builds a semantic layer over company databases. It reads table structures and sample values, names the business concepts behind them, works out how tables join, and asks a human to certify each definition. Agents query it through a read-only MCP server or a REST API, and every answer returns the SQL and steps behind it. It works with any OpenAI-compatible model.

It reads only relational databases. It does not ingest documents, GitHub issues, Discord, or meeting notes, which hold most of what Flow Research knows. It also runs as its own stack of four services plus Postgres.

We borrow its loop, not its software. An agent drafts knowledge, a person certifies it, and every answer built on that knowledge traces back to its source. The Org Brain rebuild already keeps a source locator on each insight, so a certification step is a small addition. The software becomes relevant later if Garden serves business owners whose context lives in their own databases and analytics.

## 5. What already exists

The Org Brain rebuild on `feat/org-brain-memory` has 15 commits from 2026-10-10 to 2026-10-16. It replaces the old storage-graph visualizer, which displayed Helix storage nodes such as document sections instead of knowledge a person could use.

The rebuild adds semantic insights and topics as real records, source locators preserved through extraction and chunking, hybrid search, knowledge audit workflows that dedupe and file insights into topics, and overview, topic, and insight pages. The spec lives in the Org Brain feature document on that branch. The branch is behind `dev` and will need conflict resolution before it merges.

## 6. How the pieces combine

The context layer has three parts. Org Brain extracts and certifies knowledge. Team agents, modeled on Grok Bot, do work as tasks. The routing step, which neither reference product has, sends each piece of knowledge to the teams it affects and shows it inside their tasks and on their team page.

A worked example: a GitHub issue closes with a decision to change an API. Org Brain records the decision as an insight linked to the issue. The engineering agent uses it in related tasks. Marketing's page shows the change because it affects their copy. A person certifies the insight before it becomes official company knowledge.

## 7. Rollout

Engineering comes first because Garden's current features were built for engineers. The task board, the GitHub connector, issue runs, Files, and Org Brain already match their work. They do not need new agents to get value. They need the basics to work reliably.

Marketing, operations, and the other teams cannot get that value yet. Their work does not live in GitHub, and a board with nothing on it is a poor first impression. A team that writes Garden off on day one is hard to win back.

Meetings solve that problem for every team at once. Each team already runs its own meetings on its own schedule, so meetings need no team-specific agent. Today the notes scatter. The 2026-11-05 sync alone produced notes from Gemini, Fathom twice, and Fellow, plus a weekly tl;dv report. Those notes disagreed on who owned a follow-up and misheard product names, and they sat unread in individual inboxes. Nobody received the part that concerned their own team.

The onboarding pitch for any team becomes: open Garden to see what was decided this week that affects you and what you owe.

The order:

1. **Fix the engineering basics.** Audit and repair GitHub issue sync, the task board, workspace joining and team assignment, and one end-to-end agent issue run. Samuel and Bashir use Garden for their own work first.
2. **Build the meetings feature.** Ingest notes, extract decisions and action items, and show each team its own page.
3. **Onboard everyone.** Engineering gets the full experience. Other teams start with meetings.
4. **Build engineering context routing,** then marketing's agent and connectors.
5. **Add Anytype** as a second source of team knowledge.

### Engineering basics scan, 2026-11-06

A read-only audit of the code found that the basics are a feature to build, not a set of bugs to fix:

- **GitHub issue sync does not exist.** Nothing imports issues, keeps them updated, or maps GitHub logins to Garden users. The only GitHub routes install the app. Write-back is limited to posting one comment when a person applies a result.
- **Team members see only issues assigned to them.** Managers and the team owner see the whole board (`apps/web/src/lib/server/issue-access.ts`).
- **Accepting a workspace invitation adds nobody to a team,** so a new member lands on an empty board.
- **Agent issue runs work but are not hardened.** Concurrent starts can race, a failed start is only logged, and the run lifecycle is unproven in staging (FLO-31).

## 8. Team structure

Flow Research is one Garden workspace. Separate workspaces would wall teams off from each other, and shared context across teams is the point of the product. Inside the workspace, a team is a group of people who work together every week. Products are not a separate concept in Garden. Engineering splits by product because each product has its own engineers, repositories, and meetings. Marketing, sales, and operations stay one team each because the same people serve every product. When marketing works on a Garden launch, the connection to the Garden product comes through Org Brain topics, not through a product structure.

Engineering is a kind of work, not a single team. Flow Research runs several product teams that build software: Garden, Workstream, LMS, and Blockchain. Each becomes its own Garden team, and each owns its own GitHub repositories. Linking repositories to a team lets GitHub issue sync land every issue on the right board without manual routing.

The product teams share an engineering agent and its skills, such as triaging an issue, reviewing a pull request, or writing a fix. Only the context changes from team to team. This follows the Grok Bot pattern of one role template reused by many teams.

People sometimes work across product teams. Samuel, Abiola, and Bashir can each belong to more than one. The Teams model already supports this: `team_member` is unique only per team and member (`packages/db/src/schema/teams.ts`), and an agent can be a team member too.

An engineering team counts as onboarded when its repositories are linked to its Garden team, its members have joined with GitHub logins matched to their Garden accounts, its issues appear on its board, and its meetings appear on its team page. The checklist is the same for every product team, so it is built once and repeated. The order is Garden, then Workstream, then LMS, then Blockchain.

Research is a different shape. Flow Research has several research teams, and their output is knowledge: papers, experiments, findings, and literature notes. Much of it probably does not live in GitHub issues, and where it does live is still unknown. Samuel is asking the research teams. Research joins in the second wave with meetings and Org Brain, and may be the team that tests the context layer hardest. A research agent, for example one that reads new papers and files findings into topics, comes later.

## 9. Meetings feature: agreed inputs

- **Recorder:** Gemini notes from Google Meet are the canonical source. Other recorders are out of scope.
- **Teams:** every Flow Research team exists in Garden with its members, built on the Teams feature.
- **Schedules:** each team has its own meetings and times. Google Calendar is the source for which meetings belong to which team.

The feature collects notes, extracts decisions, action items with owners, open questions, and the teams each item affects, and shows a per-team page of what was decided and what each person owes. Each item links back to its meeting. For engineering, action items can become board tasks. Meeting knowledge also feeds Org Brain, which makes the per-team page the first version of the context visualizer.

Open question: whether some meetings, such as one-on-ones or leadership sessions, stay restricted instead of open to the whole company.

## 10. Anytype

Teams use Anytype, so it belongs in the context layer eventually. It is local-first. A community MCP server reaches it through a local API on the user's own desktop at `localhost:31009`, using a key approved in the desktop app. Garden runs on Cloudflare and cannot reach a teammate's laptop. Connecting it needs either a small sync helper on each person's machine or Anytype's sync or self-hosted network. Neither path is verified against Anytype's own documentation. Onboarding must not depend on it.

## 11. Open questions

- How should a certified insight differ from a draft in the UI, and who may certify?
- Which team owns a meeting that spans several teams, and how are its items split?
- What single number tells us onboarding worked? A candidate is the share of engineering issues worked through Garden two weeks after onboarding.
- Does the Workstream mini-app contract need to change as a result of this direction? The meeting asked for it to follow Workstream's API-first model and Executor's custom apps.

## Sources

- Meeting notes from 2026-11-05 by Gemini, Fathom, and Fellow, delivered by email.
- Grok Bot: [Composio guide](https://composio.dev/content/guide-to-frok-bot), [CellCog on Team Bots](https://cellcog.ai/blog/grok-team-bots/), [Unite.AI launch coverage](https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/). These are third-party sources. CellCog is a competitor.
- NVIDIA: [auto-ontology repository](https://github.com/NVIDIA/auto-ontology). The Agent Knowledge Foundation bundle is unverified.
- Anytype: [community MCP server listing](https://lobehub.com/mcp/qwinty-anytype-mcp). Unverified against Anytype's own documentation.
