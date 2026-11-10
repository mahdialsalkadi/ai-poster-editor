# Operations and incident runbook

This runbook describes the repository's proposed single-replica Compose topology.
It has **not** been exercised on a deployment host; it is not approval to expose
the service. Complete [the security checklist](security.md#6-deployment-checklist)
and obtain staging approval before following deployment steps. Keep credentials,
designs, request bodies and full environment dumps out of tickets and logs.

## Before operation

- Use exactly one API replica. The daily spend ledger is a local file, not a
  coordinated multi-writer store. Compose mounts it at `/data/ai-spend.json` on
  the named `spend` volume; it overrides `AI_SPEND_LEDGER_PATH` from `.env`.
- Set the exact HTTPS `PUBLIC_ORIGIN`, strong authentication, a random internal
  `EXPORT_WORKER_TOKEN`, and `TRUST_PROXY` matching the actual proxy topology.
  Do not enable `ALLOW_PUBLIC_API` on an exposed instance. Configure and test TLS,
  the Chromium sandbox, worker network isolation and backups before exposure.
- Leave `AI_PROVIDER` empty or set `AI_DISABLED=true` until a provider, prices,
  cap and any paid usage are explicitly approved. Model prices are configured by
  the operator, not fetched or validated against a live price table.
- Configure log collection, retention, access controls and alerts externally;
  this repository does not ship an alerting service. Compose's local JSON-file
  logs rotate at three 10 MB files per container, not durable audit storage.

## Health and signals

On an authorized host, `docker compose ps` shows container health. The proxy
health endpoint is `/healthz`, the API endpoint is `/api/health`, and the
worker endpoint is `/health` inside its private network. A healthy process is
not proof that authentication, rendering, TLS or paid integrations work.

`docker compose logs --since=15m api worker` displays operational records. API
and worker JSON events include:

- `ai.spend.settlement`: `day` (UTC), `reservedUsd`, `actualUsd`, `spentUsd`,
  `capUsd` and optional `model`. Alert on sustained spend near the cap and
  reconcile with the provider's bill; missing provider usage may undercount cost.
- `export.queue`: `scope` (`api` or `worker`), `active`, `waiting`, `concurrency`,
  `maxWaiting`, and `rejectedTotal`. Alert on sustained waiting or increasing
  rejections. The scopes are different stages of the same work; do not add them
  as independent exports. Rejection counts reset on restart. Events occur only
  on transitions, so their absence is not proof of health.
- `api.error` and `worker.error`: sanitized server-error signals, with status
  and, for handled errors, a code. Request IDs help correlation. Error messages
  and stacks are intentionally omitted, so additional controlled investigation
  may be necessary. No external error collector is configured by default.

These records are not a complete secret scanner. Never log credentials in custom
messages, arbitrary fields or request IDs. Proxy/web access logs have separate
policies and may include request paths or queries; protect and review them too.

## Emergency AI stop

1. For an immediate suspected credential compromise, revoke or restrict the
   provider key at the provider and block outbound provider access as appropriate.
   A running request may already have incurred charges; disabling the service is
   not a refund or a guarantee that an in-flight request was cancelled.
2. Set `AI_DISABLED=true` in the deployment's `.env`, then recreate the API so it
   receives the new environment: `docker compose up -d --no-deps --force-recreate api`.
   A plain `docker compose restart api` does **not** apply changed Compose
   environment values. If the host is bare Node instead, set the variable in the
   process manager and restart the API process.
3. Confirm the API starts and an authenticated AI request returns the disabled
   `UNSUPPORTED_FEATURE` response without contacting the provider. Check the
   `AI is disabled by AI_DISABLED` warning and provider-side activity. Do not
   print credentials while verifying. Continue exports only if their security and
   availability are unaffected.
4. Investigate the cause, budget and provider usage. To restore AI, obtain
   approval, rotate compromised keys, verify model/prices/cap and ledger, unset
   the switch, and recreate the API again. A live paid-provider smoke test needs
   separate authorization.

For a renderer or API incident, restrict ingress at the proxy/firewall or stop the
affected service. Do not bypass the Chromium sandbox on a networked worker; see
the isolation conditions in [security.md](security.md).

To disable new exports without disabling other API routes, set
`EXPORT_DISABLED=true` in `.env` and recreate the API with
`docker compose up -d --no-deps --force-recreate api`. The setting is read at
startup; it does not guarantee cancellation of in-flight exports. Confirm that an
authenticated export receives `UNSUPPORTED_FEATURE` and review the startup log.
To restore exports, remove the setting and recreate the API after investigation.

## Spend ledger failure or recovery

The API fails closed for AI when the ledger cannot be loaded or written. Keep AI
disabled while investigating. Preserve the current file and volume, record the
UTC day and reconcile provider-side usage. Do **not** delete, truncate or reset
the ledger to restore service; that can silently reopen budget headroom.

Stop the API before restoring a verified backup using the host's approved volume
backup procedure. Restore the `day` and non-negative `spentUsd` as valid JSON,
with permissions allowing only the intended API account; confirm the recovered
amount does not understate provider charges, including in-flight attempts.
Preserve evidence and escalate if the correct total is uncertain. Start a single
API replica with AI still disabled, check health and logs, then re-enable only
after an authorized operator has reconciled spend and tested the cap. Backups,
restores and filesystem durability have not been verified on a deployment host.

## Staging smoke test and release gate

On an explicitly approved isolated staging environment with dedicated nonproduction
credentials and no unintended public exposure:

1. Record the commit, CI run, environment, time and operator. Verify TLS, origin,
   auth (including a rejected unauthenticated request), health and worker network
   isolation using the checklist in `docs/security.md`.
2. In the browser select a template, edit Arabic and English text, reload, and
   confirm persistence. Upload an image through the editor's local asset flow.
3. Export the design as PNG and PDF; check image dimensions, PDF page size and
   that the uploaded asset is present. Observe queue and error signals.
4. Generate and edit with a **mock or explicitly approved provider**. With AI
   disabled, confirm no provider call is made. Separately verify settlement and
   cap behavior using controlled test data; do not assume mocked usage validates
   real provider billing.
5. Record results, failures and evidence without secrets or user designs. Fix or
   explicitly accept residual risks before any release. Run the full CI matrix and
   re-review `docs/audit.md`; staging, a public deployment and a release tag each
   require their own authorization.
