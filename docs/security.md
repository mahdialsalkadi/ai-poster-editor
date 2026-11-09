# Security model and threat assessment

Last reviewed: 9 November 2026. Scope: the public deployment topology in
`docker-compose.yml` and the application code it runs. This document records
controls that exist in source, divides them into verified and unverified, and
lists the residual risk accepted before a public launch. It is not a
certification, and it does not replace the evidence in [audit.md](audit.md).

## 1. System and trust boundaries

```text
Internet
  │  HTTPS (TLS 1.2/1.3, HSTS, frame-ancestors)
  ▼
proxy (nginx, publishes 80/443)
  ├── /      ──▶ web (nginx, static editor bundle)
  └── /api/  ──▶ api (Fastify, Node 22)
                   ├──▶ Supabase Auth (login/refresh, JWKS)
                   ├──▶ AI provider (only when AI_PROVIDER is configured)
                   ├──▶ spend volume (daily USD ledger)
                   └──▶ worker (internal network, bearer token)
                          └── Chromium (sandbox, no egress, scrubbed env)
```

Trust boundaries:

1. **Internet → proxy.** Everything from a browser is untrusted.
2. **Proxy → API.** Same-origin `/api` only. The API trusts one forwarded hop
   (`TRUST_PROXY=1`) and requires an exact `PUBLIC_ORIGIN` for CORS and for
   cookie-authenticated writes.
3. **API → worker.** Private, authenticated by a shared bearer token. The
   worker has no public address and no route off its `internal: true` network.
4. **API → Supabase / AI provider.** Outbound only, over the edge network.
5. **Browser storage.** IndexedDB holds assets and pre-edit snapshots;
   `localStorage` holds the current document. This data never leaves the browser
   except as part of an export or AI request.

## 2. Assets

- AI provider credential (`AI_API_KEY`) and the spend budget it can consume.
- Supabase anon key, Supabase JWT secret or JWKS, and the session-cookie HMAC
  key (`AUTH_COOKIE_SECRET`).
- `API_ACCESS_KEY` for machine clients.
- `EXPORT_WORKER_TOKEN`, shared only by the API and worker.
- Users' designs and uploaded image bytes in transit.
- API availability, worker CPU/memory and the spend ledger.

## 3. Actors

Anonymous visitor, signed-in user, machine client with an API key, deployment
operator, and a remote attacker who can send arbitrary HTTP or model output.
The AI provider and Supabase are external dependencies and are not fully trusted
to return well-formed or benign data.

## 4. Threats and controls

| ID  | Threat                                                 | Control                                                                                                                                                                                                                                                                                                                                                                                                                | Residual risk                                                                                                                 |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| T1  | Account takeover by credential stuffing                | Login is rate limited per IP; Supabase owns password hashing, lockouts and email verification. Provider error bodies are never echoed, so account existence is not disclosed.                                                                                                                                                                                                                                          | No MFA requirement in this app; Supabase project settings decide lockout and verification policy.                             |
| T2  | Session theft or XSS-readable session                  | Session cookie is `HttpOnly`, `SameSite=Lax`, HMAC-signed, `Secure` in production and refreshed server-side. Strict CSP ships in the built shell: `default-src 'none'`, `script-src 'self'`, no inline script, no `unsafe-eval`. React renders text as children; there is no `innerHTML`.                                                                                                                              | A compromised dependency running in the page can still call same-origin APIs as the user; CSP does not stop that.             |
| T3  | CSRF on cookie-authenticated writes                    | `SameSite=Lax`, exact-origin CORS allowlist, and an explicit `Origin` check for cookie-authenticated non-GET requests.                                                                                                                                                                                                                                                                                                 | API-key clients are unaffected by CSRF but hold a powerful shared secret; rotate it.                                          |
| T4  | Unauthenticated use of expensive routes                | Every route except `GET /api/health`, `POST /api/auth/login` and logout requires a principal. Production refuses to start without Supabase or `API_ACCESS_KEY` unless `ALLOW_PUBLIC_API=true`. API keys are compared in constant time.                                                                                                                                                                                 | The opt-out flag is intentionally dangerous and must never be set on a public host.                                           |
| T5  | AI spend abuse or runaway retries                      | Per-attempt worst-case reservations, a durable daily ledger, mandatory prices when a provider is configured, `AI_DISABLED` kill switch, and per-IP/per-principal rate limits. A retry reserves again and is refused before the second provider call.                                                                                                                                                                   | The ledger is single-replica and per deployment, not per user; one user can consume the whole daily budget.                   |
| T6  | Prompt injection through design text                   | Design data is wrapped in an untrusted block, the closing sequence is neutralized, the instruction is a separate capped field, and model output crosses the full parser security boundary before any merge.                                                                                                                                                                                                            | The model can still follow injected instructions within its own output; it has no tools or network access.                    |
| T7  | Malicious Design HTML or SVG                           | Allowlist parser rejects scripts, event handlers, external URLs, CSS escapes and forbidden SVG features. Model output and imported documents use the same boundary.                                                                                                                                                                                                                                                    | Canonicalization is not a browser-equivalent CSS engine; import is best-effort.                                               |
| T8  | Renderer escape, SSRF or secret discovery              | Dedicated worker process with a scrubbed environment (no provider, Supabase or API secrets), Chromium sandbox enabled, page JavaScript disabled, service workers blocked, context offline, every HTTP(S) request aborted, export CSP `default-src 'none'`, 15-second total deadline, process-group kill, 512 MiB Node heap. In Compose the worker is non-root, capability-free and on an egress-free internal network. | Chromium is a large attack surface; a kernel or browser 0-day remains. Docker sandbox behaviour is not verified on this host. |
| T9  | Cross-user data access                                 | The API stores no documents or snapshots. Snapshots are browser-local. The export cache is keyed by authenticated principal plus IP, expires in 10 minutes and is bounded by entries and bytes.                                                                                                                                                                                                                        | Export results for one principal are still in API memory and are not encrypted there.                                         |
| T10 | Uploaded asset bombs, polyglots or side-channel probes | Multipart and body limits, type sniffing, `sharp` re-encode, dimension and pixel limits, and only referenced assets are accepted. Assets travel inline as `data:` URIs to the renderer.                                                                                                                                                                                                                                | Side dimensions are checked after decode, not from the header. The public upload route is a stub.                             |
| T11 | Denial of service against API or renderer              | JSON body limit, export request/response limits, render queue cap with rejection, per-route sliding-window limits, Compose CPU/memory/PID limits and health checks.                                                                                                                                                                                                                                                    | Rate limits are in-memory per replica; there is no CDN, WAF or volumetric protection in this repository.                      |
| T12 | Secret leakage into images, bundles or logs            | `.env` and `.dockerignore` exclude secrets from build contexts; only server-side variables hold keys; no `VITE_` secret exists; the worker gets an allowlisted environment at the process and container level.                                                                                                                                                                                                         | There is no dedicated log-redaction filter; new log statements must never log headers, cookies or environment values.         |
| T13 | Supply-chain compromise                                | Exact pnpm version, frozen lockfile installs, `minimumReleaseAge: 1440` (one day) with only the data-only `caniuse-lite` excluded, Dependabot groups, a blocking `pnpm audit --prod` CI step, exact Playwright pin and pinned Playwright image, GitHub Actions pinned to commit SHAs with read-only tokens.                                                                                                            | A determined registry or transitive compromise can still pass these gates; review dependency diffs.                           |
| T14 | Container breakout or lateral movement                 | Non-root users (`node` / `pwuser`), `cap_drop: ALL`, `no-new-privileges`, no published worker port, internal network without egress, `shm_size` and PID limits.                                                                                                                                                                                                                                                        | All services share the Docker daemon and host kernel; a kernel escape is out of scope.                                        |
| T15 | Transport interception or downgrade                    | TLS 1.2/1.3 only, HSTS with `includeSubDomains`, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, 64 MiB body cap above the 40 MiB export limit.                                                                                                                                                                                                                                                 | Certificate issuance and renewal are manual; there is no OCSP stapling or automated renewal in the compose file.              |
| T16 | Data retention and privacy                             | The server stores only a daily USD total; no prompts, designs or images are persisted. Browser snapshots are local.                                                                                                                                                                                                                                                                                                    | Container logs and the spend volume survive restarts; operators must set retention and back up/delete as required.            |

## 5. Residual risks accepted before launch

- **Single API replica.** The spend ledger is an atomically written file. Running
  two API containers against it is unsupported and would under-count spend.
- **No per-user quota.** The daily cap is deployment-wide; one authenticated user
  can exhaust it for everyone.
- **No application-level MFA or step-up auth.** Supabase controls password policy,
  email verification and MFA availability.
- **In-memory rate limits and export cache.** Both reset on restart and are not
  shared across replicas.
- **Browser-local snapshots.** They are not encrypted at rest and are lost when
  site data is cleared.
- **Container behaviour is unverified here.** The images, compose file and proxy
  configuration were written and reviewed, but Docker is not installed on the host
  that prepared them. Sandbox availability, TLS startup, health-check timing and
  the egress-free worker network still need a runtime check on the deployment host.
- **Chromium sandbox.** If the host blocks unprivileged user namespaces, apply the
  documented seccomp override or, only for the no-egress disposable worker, set
  `EXPORT_CHROMIUM_SANDBOX=false`.
- **No CDN/WAF, autoscaling, backup automation or TLS renewal** in this repository.

## 6. Deployment checklist

Before exposing the proxy:

- [ ] `PUBLIC_ORIGIN` is the exact `https://` origin users type, and DNS points at
      the host.
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, a 32+ character `AUTH_COOKIE_SECRET`
      and either `SUPABASE_JWT_SECRET` or the project's JWKS endpoint work for the
      project; or a server-only `API_ACCESS_KEY` is set.
- [ ] `EXPORT_WORKER_TOKEN` is random and set only in `.env`; the worker has no
      other secrets.
- [ ] `fullchain.pem` and `privkey.pem` are present and current.
- [ ] `TRUST_PROXY=1` matches exactly one proxy hop.
- [ ] Exactly one API container runs, and the `spend` volume is included in
      backups.
- [ ] `AI_PROVIDER`, `AI_MODEL` and both prices agree; `AI_DAILY_SPEND_CAP_USD`
      is intentional; `AI_DISABLED=true` has been tried once as a kill switch.
- [ ] `pnpm audit --prod` passes and the CI workflow is green.
- [ ] Sign-in, logout, a signed-out 401, and two accounts' data isolation were
      exercised against the real origin.
- [ ] The worker cannot reach the internet:
      `docker compose exec worker node -e "fetch('https://example.com').then(() => process.exit(1)).catch(() => process.exit(0))"`.
- [ ] Export (PNG, PDF) succeeds through the proxy with a real design.

## 7. Verification status

Verified by automated tests: access control, sign-in cookie lifecycle, JWT
signature/issuer/audience checks, origin rejection, route limits, spend
persistence/reservation/kill switch, export-cache scoping, worker environment
scrubbing, request cancellation and deadline kill, CSP contents, and the parser
security corpus.

Verified manually during the audit: the editor has no `innerHTML`; the built
shell contains the CSP meta tag and no inline script; exports use native vector
PDF.

Not verified here: container startup, Chromium sandbox inside Docker, TLS and
proxy headers on a live host, a live Supabase sign-in, a live AI provider call,
two-account isolation against a deployed origin, and browser snapshot restore.
