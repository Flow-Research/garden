# Brain Docker Compose Deployment

This document describes the Docker Compose deployment for Garden Brain, currently managed through Coolify. The stack uses Caddy as the secured gateway and HelixDB as the private graph and vector database.

The deployment does not depend on Coolify. It can run on any server with Docker Compose, although another deployment environment would need to provide its own domain routing, TLS certificates, secret management and operational controls.

## Architecture

```text
Garden server
    |
    | Authorization: Bearer <BRAIN_API_SECRET>
    v
Caddy gateway
    |
    | Private Docker network
    v
HelixDB
```

- Garden is the only intended caller of the gateway.
- Caddy verifies a shared bearer secret.
- HelixDB has no public port or domain.
- Garden browsers and frontend code must never receive the secret.
- Garden’s server-side Brain integration layer owns query construction and workspace isolation.

## Component responsibilities

### Garden

Garden authenticates users through its existing authentication system and runs agents and automations.

Garden’s server is the only Garden component that holds the Brain API credentials. It is responsible for determining the active workspace and constructing authorized Helix queries.

### Caddy gateway

Caddy provides the public Brain API boundary. It:

- Listens internally on port `3000`.
- Exposes a public `/healthz` endpoint.
- Verifies the shared bearer secret.
- Rejects unauthorized requests.
- Forwards authorized requests to private HelixDB.
- Removes the authorization header before forwarding.

Caddy authenticates Garden as the caller. It does not determine which workspace or records a Garden user may access.

### HelixDB

HelixDB provides graph and vector storage and query execution. It:

- Listens internally on port `8080`.
- Is accessible only through the private Docker network.
- Has no public domain or host port.
- Uses a persistent Docker volume until R2 storage is available.

### Docker Compose

Docker Compose:

- Defines the HelixDB and Caddy services.
- Places both services on the same private network.
- Provides service discovery through the hostname `helix`.
- Manages the persistent `helix-data` volume.
- Supplies the gateway environment variable and Caddy configuration.

### Coolify

Coolify currently manages the Docker Compose deployment. It provides:

- Deployment and container lifecycle management.
- Environment-variable management.
- Persistent-volume management.
- Logs and container health information.
- Public domain routing to Caddy.
- TLS management for the production domain.

Coolify is not responsible for the Brain gateway’s authentication. Caddy provides that authentication.

## Deployment file

The stack is defined in the repository root:

```text
compose.brain.yaml
```

It contains:

- `helix` — the private HelixDB service.
- `gateway` — the Caddy authentication and reverse-proxy service.
- `helix-data` — persistent local storage for HelixDB.
- `brain-caddyfile` — the embedded Caddy gateway configuration.

## Docker Compose configuration

```yaml
services:
  helix:
    image: ghcr.io/helixdb/helixdb:v0.0.4
    restart: unless-stopped
    environment:
      HELIX_DATA_DIR: /var/lib/helix
    volumes:
      - helix-data:/var/lib/helix

  gateway:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - helix
    environment:
      BRAIN_API_SECRET: ${BRAIN_API_SECRET}
    expose:
      - "3000"
    configs:
      - source: brain-caddyfile
        target: /etc/caddy/Caddyfile
    healthcheck:
      test:
        - CMD
        - wget
        - --quiet
        - --tries=1
        - --spider
        - http://127.0.0.1:3000/healthz
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s

configs:
  brain-caddyfile:
    content: |
      :3000 {
          handle /healthz {
              respond "OK" 200
          }

          @authorized header Authorization "Bearer ${BRAIN_API_SECRET}"

          handle @authorized {
              reverse_proxy helix:8080 {
                  header_up -Authorization
              }
          }

          respond "Unauthorized" 401
      }

volumes:
  helix-data:
```

The `${BRAIN_API_SECRET}` reference inside the Caddy configuration is intentionally resolved by Docker Compose from the deployment environment.

## Required environment variable

Generate a 64-character secret:

```bash
openssl rand -hex 32
```

Configure it in the deployment environment:

```env
BRAIN_API_SECRET=<generated-secret>
```

Do not commit the real value to Git.

## Coolify deployment

1. Create a Docker Compose resource from the Garden repository.
2. Set the Compose file path to:

```text
compose.brain.yaml
```

3. Add `BRAIN_API_SECRET` under **Environment Variables**.
4. Deploy the stack.
5. Confirm that both `helix` and `gateway` are running.
6. Assign a domain only to the `gateway` service.
7. Set the gateway container port to `3000`.
8. Leave the domain path empty.

The intended production domain is:

```text
https://brain-api.flowresearch.tech
```

Do not assign a domain to the `helix` service.

## Garden configuration

Provide Garden’s server environment with:

```env
BRAIN_API_URL=https://brain-api.flowresearch.tech
BRAIN_API_SECRET=<same-secret-configured-for-the-gateway>
```

Garden sends the secret on every request:

```http
Authorization: Bearer <BRAIN_API_SECRET>
```

Garden calls Helix through the secured gateway:

```text
POST ${BRAIN_API_URL}/v2/query
```

`BRAIN_API_URL` and `BRAIN_API_SECRET` are server-only variables. They must not be exposed through browser environment variables, client bundles, logs or API responses.

## Authentication boundary

The shared bearer secret authenticates Garden as the caller of the Brain API.

For the initial deployment:

- Garden’s server is the only trusted caller.
- Users authenticate to Garden through Garden’s existing authentication system.
- Agents and automations operate through trusted Garden server infrastructure.
- The gateway does not independently authenticate individual users, agents or automation runs.
- JWT, JWKS and OIDC infrastructure are not required for this initial server-to-server integration.

Identity-aware gateway authentication may be added later if external systems need direct Brain access.

## Workspace isolation

The shared secret proves that a request came from Garden. It does not independently enforce workspace authorization.

Garden must implement a trusted server-side Brain integration layer. Its final location in the repository should be decided by the Garden maintainers. It may live in the existing `packages/server` package or in a new dedicated package.

This integration layer must:

- Construct all permitted Helix queries.
- Resolve the active Garden workspace.
- Inject the workspace or tenant identifier into every read and write.
- Prevent browsers from submitting arbitrary Helix query JSON.
- Prevent one workspace from reading or modifying another workspace’s records.
- Expose typed Brain operations to Garden’s server-side services, agents and automations.

The browser must never call the Brain API directly.

The Caddy gateway intentionally does not parse or modify Helix queries. Query-level authorization belongs in Garden’s trusted server-side integration because Helix accepts caller-constructed query payloads.

## Health checks

The Caddy gateway health endpoint is public:

```bash
curl -i https://brain-api.flowresearch.tech/healthz
```

Expected response:

```text
HTTP/1.1 200 OK

OK
```

The Helix readiness endpoint is protected:

```bash
curl -i https://brain-api.flowresearch.tech/readyz
```

Expected response without authentication:

```text
HTTP/1.1 401 Unauthorized
```

Test with the configured secret:

```bash
curl -i \
  https://brain-api.flowresearch.tech/readyz \
  -H "Authorization: Bearer ${BRAIN_API_SECRET}"
```

Expected response:

```text
HTTP/1.1 200 OK
```

with a Helix response similar to:

```json
{
  "index_runtime": "ready",
  "mode": "writer",
  "ready": true
}
```

## Query test

An authenticated query request is sent to:

```bash
curl -i \
  -X POST \
  https://brain-api.flowresearch.tech/v2/query \
  -H "Authorization: Bearer ${BRAIN_API_SECRET}" \
  -H "Content-Type: application/json" \
  --data-binary @request.json
```

`request.json` must contain a valid HelixDB v2 query.

A request without the correct bearer secret should receive:

```text
HTTP/1.1 401 Unauthorized
```

A request with the correct secret but an invalid Helix query should receive a Helix validation error. This confirms that the request passed through Caddy and reached HelixDB.

## Storage

The initial deployment uses:

```env
HELIX_DATA_DIR=/var/lib/helix
```

with the persistent Docker volume:

```text
helix-data
```

This allows the deployment to run before Cloudflare R2 is ready.

Do not remove the volume while it contains data that must be preserved.

## Migrating to R2

Helix supports either local persistent storage or S3-compatible object storage. `HELIX_DATA_DIR` and `S3_BUCKET` must not be configured simultaneously.

When R2 is ready, remove the following from the `helix` service:

```yaml
environment:
  HELIX_DATA_DIR: /var/lib/helix
volumes:
  - helix-data:/var/lib/helix
```

Replace it with:

```yaml
environment:
  S3_BUCKET: ${S3_BUCKET}
  S3_REGION: ${S3_REGION:-auto}
  DB_PATH: ${DB_PATH:-production/}
  AWS_ENDPOINT: ${AWS_ENDPOINT}
  AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
  AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
```

Add the corresponding values to the deployment environment as protected variables.

Plan the data migration before switching storage modes. Changing the configuration does not automatically copy existing local-volume data into R2.

## Secret rotation

To rotate the gateway secret:

1. Generate a new secret:

```bash
openssl rand -hex 32
```

2. Update `BRAIN_API_SECRET` in the gateway deployment environment.
3. Redeploy the Brain stack.
4. Update `BRAIN_API_SECRET` in Garden.
5. Redeploy Garden.
6. Confirm authenticated access to `/readyz`.

This simple initial configuration requires coordinated deployment. If zero-downtime rotation becomes necessary, the gateway can later accept both current and next secrets during a rotation window.

## Temporary testing domains

Coolify-generated `sslip.io` domains may be used for initial connectivity testing.

Do not use a plain HTTP endpoint for production because the bearer secret would travel without transport encryption. Replace the temporary URL with the HTTPS production domain before connecting the production Garden deployment.

Do not commit temporary deployment URLs as production configuration.

## Troubleshooting

### Public request returns `401`

This is expected for every endpoint except `/healthz`.

### Authenticated request returns `401`

Confirm that:

- Garden and the gateway use exactly the same secret.
- The secret contains no quotes or surrounding spaces.
- The gateway was redeployed after changing the variable.
- The header uses the exact format:

```http
Authorization: Bearer <secret>
```

Check that the gateway container received the secret without displaying it:

```sh
test -n "$BRAIN_API_SECRET" && echo "Secret configured" || echo "Secret missing"
printf %s "$BRAIN_API_SECRET" | wc -c
```

A secret generated with `openssl rand -hex 32` has a length of `64`.

Test from inside the gateway container:

```sh
wget -S -O- \
  --header="Authorization: Bearer $BRAIN_API_SECRET" \
  http://127.0.0.1:3000/readyz
```

### Generated domain returns `404 page not found`

Confirm that the domain:

- Is saved against the `gateway` service.
- Uses container port `3000`.
- Has no configured path.
- Uses the protocol supported by the generated domain.
- Was followed by a redeploy if required.

### `/healthz` succeeds but `/readyz` fails

Check the Helix runtime logs and confirm that Helix is listening internally on:

```text
0.0.0.0:8080
```

The gateway reaches Helix using the private Compose service address:

```text
http://helix:8080
```

### Gateway configuration changes do not take effect

Save the Compose file and perform a full redeploy so the Caddy container and embedded configuration are recreated. A simple container restart may continue using the previous generated configuration.

## Production checklist

Before connecting the production Garden deployment, confirm that:

- The Brain API uses HTTPS.
- `BRAIN_API_SECRET` has been rotated from any value used over temporary HTTP.
- HelixDB has no public domain.
- HelixDB has no published host port.
- Only the Caddy gateway is publicly reachable.
- Garden stores the Brain credentials only in its server environment.
- Browser code cannot access the Brain credentials.
- Garden constructs workspace-scoped queries on the server.
- Persistent storage and backups have been planned.
- The authenticated `/readyz` test succeeds.
