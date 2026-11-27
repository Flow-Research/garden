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
3. Under **Environment Variables**, add `BRAIN_API_SECRET`, `S3_BUCKET`, `DB_PATH`, `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.
4. Mark the gateway secret and both R2 credential values as protected variables.
5. Follow [Prepare R2 storage](#prepare-r2-storage) before the first R2 deploy.
6. Deploy the stack.
7. Confirm that the `helix` and `gateway` services are running.
8. Assign a domain to the `gateway` service only. Set its container port to `3000` and leave the path empty.

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

## Prepare R2 storage

`compose.brain.yaml` selects R2 with `S3_BUCKET`. It does not mount the old `helix-data` volume. Deployment does not move data from that volume to R2.

The owner must confirm that the old volume contains only disposable test data before accepting an empty R2 database. If old data must remain available, the owner must approve a migration and test its restore path. Keep the old volume until that decision and the checks after cutover finish.

Set `S3_BUCKET` to the R2 bucket name. Set `AWS_ENDPOINT` to its HTTPS S3 endpoint. Set `S3_REGION` to `auto` or leave it unset. Set `DB_PATH` to a unique prefix for this deployment, such as `production/` for production. Do not reuse the same bucket and prefix for staging or preview.

Compose requires the bucket, prefix, endpoint, access key, and secret key. These checks only test that values exist. They do not prove that Helix opened the intended R2 location. Confirm that the pinned `v0.0.4` image reads these variables before deployment. Helix requires conditional object writes, so confirm that R2 rejects writes when an object condition fails.

Create an R2 token with read, write, and list access to this bucket only. Do not use an account-wide token. Store both token values as protected variables in Coolify. Do not set `HELIX_DATA_DIR` with `S3_BUCKET`.

Before the cutover, make an independent backup of data that must survive. Record the bucket and prefix in the operations record. Set up a backup schedule and test a restore into a separate prefix. Do not treat the R2 bucket as its own backup.

Stop the old Helix container before the new container opens the same bucket and prefix. Keep one writer on that prefix during deployment and rollback. Confirm this stop-before-start order in Coolify before the first cutover.

After the deploy, send a valid HelixDB v2 write query with a unique test record. Read that record through the gateway. Restart only the Helix container, then read the same record again. Confirm that objects appeared under the intended R2 bucket and prefix. A successful `/readyz` response alone does not prove persistence.

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
- The owner approved the old-volume cutover or a tested migration.
- The R2 token reaches only the selected bucket.
- Production and nonproduction use different R2 prefixes.
- A separate backup exists and a restore into another prefix worked.
- Coolify stops the old Helix writer before starting its replacement.
- A written record remains readable after a Helix restart.
- The authenticated `/readyz` check passes.
