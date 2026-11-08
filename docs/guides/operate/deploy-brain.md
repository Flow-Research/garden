---
title: Deploy Brain
description: Deploy the Brain HelixDB stack with Docker Compose, connect Garden to it with HELIX_URL and HELIX_API_KEY, and fix common gateway failures.
status: current
owner: "@Flow-Research/security"
last_reviewed: 2026-11-03
---

This guide deploys `compose.brain.yaml`, which runs HelixDB behind a Caddy gateway, and connects Garden to it. For why the stack is shaped this way, see [Brain architecture](../../concepts/architecture/brain.md).

## Generate the gateway secret

Run this command to make a 64-character secret:

```bash
openssl rand -hex 32
```

The same value goes in two places. The gateway reads it as `BRAIN_API_SECRET`. Garden reads it as `HELIX_API_KEY`. Do not commit the real value.

## Deploy the stack on Coolify

1. Create a Docker Compose resource from the Garden repository.
2. Set the Compose file path to `compose.brain.yaml`.
3. Under **Environment Variables**, add `BRAIN_API_SECRET` with the secret.
4. Deploy the stack.
5. Confirm that the `helix` and `gateway` services are running.
6. Assign a domain to the `gateway` service only. Set its container port to `3000` and leave the path empty.

The production domain is `https://brain-api.flowresearch.tech`. Do not assign a domain to `helix`.

To run on another Docker Compose host, provide your own domain routing, TLS, and secret storage.

## Connect Garden

Set these server variables for the Garden Worker. Both are declared in `apps/web/wrangler.jsonc` and validated in `packages/env/src/index.ts`.

```dotenv
HELIX_URL=https://brain-api.flowresearch.tech
HELIX_API_KEY=<same value as BRAIN_API_SECRET>
```

Garden sends `Authorization: Bearer <HELIX_API_KEY>` to `POST <HELIX_URL>/v2/query`. Never set `HELIX_URL` to a localhost address in a deployed Worker. Never expose either variable to browser code.

## Check the deployment

1. Check the public health endpoint. Expect `200 OK` with body `OK`.

    ```bash
    curl -i https://brain-api.flowresearch.tech/healthz
    ```

2. Check that `/readyz` rejects a request with no secret. Expect `401 Unauthorized`.

    ```bash
    curl -i https://brain-api.flowresearch.tech/readyz
    ```

3. Check `/readyz` with the secret. Expect `200 OK` and a body with `"ready": true`.

    ```bash
    curl -i https://brain-api.flowresearch.tech/readyz \
      -H "Authorization: Bearer ${BRAIN_API_SECRET}"
    ```

4. Send a query. Put a valid HelixDB v2 query in `request.json`.

    ```bash
    curl -i -X POST https://brain-api.flowresearch.tech/v2/query \
      -H "Authorization: Bearer ${BRAIN_API_SECRET}" \
      -H "Content-Type: application/json" \
      --data-binary @request.json
    ```

    An invalid query with the right secret returns a Helix validation error. That error proves the request reached HelixDB.

## Move storage to R2

HelixDB uses either `HELIX_DATA_DIR` or `S3_BUCKET`, never both. Switching does not copy data, so plan the data move first.

1. In the `helix` service, remove the `HELIX_DATA_DIR` variable and the `helix-data` volume mount.
2. Add these variables to the `helix` service:

    ```yaml
    environment:
      S3_BUCKET: ${S3_BUCKET}
      S3_REGION: ${S3_REGION:-auto}
      DB_PATH: ${DB_PATH:-production/}
      AWS_ENDPOINT: ${AWS_ENDPOINT}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    ```

3. Add the values to the deployment environment as protected variables.
4. Redeploy and run the checks above.

Do not delete the `helix-data` volume while it holds data you need.

## Rotate the secret

Rotation needs a coordinated deploy, because the gateway accepts one secret at a time.

1. Generate a new secret with `openssl rand -hex 32`.
2. Update `BRAIN_API_SECRET` in the gateway environment.
3. Redeploy the Brain stack.
4. Update `HELIX_API_KEY` in Garden.
5. Redeploy Garden.
6. Run the authenticated `/readyz` check.

## Use a temporary domain for testing only

Coolify-generated `sslip.io` domains work for a first connectivity test. Do not use a plain HTTP endpoint in production, because the secret would travel unencrypted. If you used one, rotate the secret before you connect production Garden. Do not commit temporary URLs as configuration.

## Troubleshoot

### A public request returns 401

This is expected for every path except `/healthz`.

### An authenticated request returns 401

Check these causes:

- Garden's `HELIX_API_KEY` and the gateway's `BRAIN_API_SECRET` differ.
- The secret has quotes or spaces around it.
- The gateway was not redeployed after the variable changed.
- The header is not exactly `Authorization: Bearer <secret>`.

To check the secret inside the gateway container without printing it, run:

```sh
test -n "$BRAIN_API_SECRET" && echo "Secret configured" || echo "Secret missing"
printf %s "$BRAIN_API_SECRET" | wc -c
```

A secret from `openssl rand -hex 32` has length 64. To test from inside the gateway container, run:

```sh
wget -S -O- \
  --header="Authorization: Bearer $BRAIN_API_SECRET" \
  http://127.0.0.1:3000/readyz
```

### The generated domain returns 404 page not found

Check that the domain is saved on the `gateway` service, uses container port `3000`, has no path, and uses the protocol the domain supports. Redeploy if Coolify asks.

### /healthz works but /readyz fails

Check the Helix logs. Helix must listen on `0.0.0.0:8080`. The gateway reaches it at `http://helix:8080`.

### Gateway config changes do not apply

Save the Compose file and run a full redeploy. A container restart can keep the old generated Caddy config.

## Production checklist

Before you connect production Garden, confirm each item:

- The Brain API uses HTTPS.
- The secret was rotated if it ever crossed plain HTTP.
- HelixDB has no public domain and no published host port.
- Only the Caddy gateway is public.
- `HELIX_URL` and `HELIX_API_KEY` exist only in Garden's server environment.
- Persistent storage and backups are planned.
- The authenticated `/readyz` check passes.
