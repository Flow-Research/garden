# Garden — Ubiquitous Language

## Org Brain

The brain for the organisation: the org's knowledge, modeled as a graph, accessible to agents and people.

- **Synonyms (same concept):** Company Brain, Context Graph, workspace context graph. Canonical term: **Org Brain**.
- **Not:** a Google Drive killer, a doc editor, or a flat knowledge base. A goal is that people can comfortably move away from Google Drive, but Drive replacement is not the product identity.
- **Relationship to Garden artifacts:** the Org Brain is *not* built over the artifacts Garden already produces (issue runs, work products, thread documents). Artifacts can be *added to the graph* later; they are not its foundation.
- **Status:** neither product direction nor technical direction is verified yet. Modeling-with-graphs is the settled intent; everything else is open.

## Garden Mail

Garden Mail is company-domain email where workspace members and agents work
together without losing ownership, authorship, or control.

**Inbox**:
A personalized view of mail conversations and Garden attention items that need
the viewer's awareness or action.
_Avoid_: treating the Inbox as a stored message type or as a synonym for email

**Mailbox**:
A private, shared, or agent-led workspace that receives email through one or
more addresses and grants access to members and agents.
_Avoid_: account, agent instance

**Address**:
An externally reachable email identity on a company domain that delivers to a
mailbox.
_Avoid_: mailbox

**Conversation**:
The ordered history of email messages, drafts, and attributable collaboration
around one external thread.
_Avoid_: chat, notification

**Message**:
An immutable authored email received from or sent to external participants.
_Avoid_: event, draft

**Draft**:
An editable proposed message whose human or agent authorship remains visible
through review and sending.
_Avoid_: message

**Attention item**:
A Garden-generated request for awareness or action, such as an approval,
mention, blocker, or agent question.
_Avoid_: notification, email

**Delivery attempt**:
The recorded outcome of trying to carry a message to external recipients.
_Avoid_: message status
