---
title: Brain keeps HelixDB private behind a gateway and Garden's server
description: How Garden's Brain reaches HelixDB through an authenticated Caddy gateway, and why workspace isolation lives in Garden's server code rather than the gateway.
status: current
owner: "@Flow-Research/security"
last_reviewed: 2026-11-03
---

Brain is Garden's graph and vector memory. It stores workspace knowledge in HelixDB. HelixDB accepts query payloads that the caller builds, so whoever can reach it can read or write any record. The whole design follows from that fact: HelixDB is never public, and only Garden's server builds queries.

## Three hops, one public

A Brain call takes this path:

```text
Garden Worker (packages/brain)
    |
    | Authorization: Bearer <HELIX_API_KEY>
    v
Caddy gateway (public, port 3000)
    |
    | private Docker network
    v
HelixDB (private, port 8080)
```

The stack is defined in `compose.brain.yaml` at the repository root. Coolify runs it today, but any Docker Compose host works if it provides domain routing, TLS, and secret storage.

## Each component has one job

The components split the work like this:

- **Garden's server** holds the Brain credentials. It authenticates users, picks the active workspace, and builds every Helix query. `HelixClient` in `packages/brain/src/services/HelixClient.ts` sends each query as `POST <HELIX_URL>/v2/query` with a 30 second deadline.
- **The Caddy gateway** is the only public entry. It answers `/healthz` without auth, checks the bearer secret on every other path, removes the `Authorization` header, and forwards the request to `helix:8080`. It returns 401 for anything else.
- **HelixDB** stores the graph and vectors and runs queries. It has no public domain and no host port. Its data sits in the `helix-data` Docker volume.
- **Docker Compose** puts both services on one private network and gives HelixDB the host name `helix`.
- **Coolify** handles deploys, environment variables, volumes, logs, the public domain, and TLS. It does not do Brain authentication. Caddy does.

## The secret proves Garden, not the user

The shared bearer secret proves that a request came from Garden's server. It says nothing about which user, agent, or automation run made the call, and the gateway does not check that. Users sign in to Garden. Agents and automations run inside Garden's trusted server code. JWT, JWKS, and OIDC are not needed for this server-to-server link. If outside systems ever need direct Brain access, the gateway would need identity-aware auth.

The secret is server-only. It never reaches browsers, client bundles, logs, or API responses. The browser never calls the Brain API directly. Browser requests go through Garden routes such as `apps/web/src/routes/api/brain/`.

## Workspace isolation lives in packages/brain

Because the gateway only checks the secret, Garden's server must enforce workspace isolation itself. The gateway deliberately does not parse or change queries.

That job belongs to `packages/brain`. The `Brain` service in `packages/brain/src/services/Brain.ts` builds the queries and stamps each record with its `workspace_id`. `packages/brain/src/domain/scope.ts` adds a finer scope inside a workspace: `org`, `team`, or `user`. `canViewScope` decides whether a viewer may see a record.

The rules this layer follows:

- Garden code builds every Helix query. Browsers cannot submit Helix query JSON.
- Every read and write carries the workspace id.
- One workspace cannot read or change another workspace's records.
- Agents and automations use typed Brain operations, not raw queries.

## Storage is local for now

HelixDB stores data in the `helix-data` volume through `HELIX_DATA_DIR`. HelixDB can use S3-compatible storage such as R2 instead, but not both at once. Switching does not copy existing data. The [deploy Brain guide](../../guides/operate/deploy-brain.md) has the steps.
