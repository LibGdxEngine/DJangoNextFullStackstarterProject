# CI/CD and isolated VPS test deployment

Date: 2026-09-09. Mode: **DELIBERATE**. Status: revised after Critic ITERATE on historical replay; ready for mandatory Architect re-review then Critic. Implementation and external changes are handled by the parent agent under the user's existing authorization; this document does not initiate them.

## Context and work objectives

Deliver hosted GitHub Actions quality gates, immutable application images in GHCR, a restricted SSH deployment interface, and one working test instance on the existing shared VPS. Preserve and include the user's current API and observability changes in the tested source snapshot. “Always deployable” means enforced, demonstrated release checks, repeatable deployment, and documented recovery; it cannot mean infallibility.

Read-only discovery reported by the parent: the existing public repository is `LibGdxEngine/DJangoNextFullStackstarterProject`, branch `master`, with usable GitHub administrator authorization. The VPS is x86_64, has 8 GB RAM with about 3.5 GB available, about 49 GB free disk, and approximately 2 GB swap already used. Docker Compose is v5.1.4. `search_caddy` owns ports 80/443. Existing `search_*` and `shaarawy_*` services must remain unchanged. The selected hostname is `mobser-test.2.24.9.126.sslip.io`. Shared Caddy reads `/root/home/ILM_SHAMELA/caddy/Caddyfile` as a single file bind mount; existing domains are `ilmshamela.com` and `athar-shaarawy.com`. The implementation workspace is `/home/ahmed/Documents/Mobser-cicd`, branch `codex/cicd-vps`: the parent copied 268 current source/config files excluding live secrets, SQLite/log/cache files and `.omc`, leaving the original worktree untouched. A final snapshot/secret review remains required before push. Preparatory discovery: the parent reports `npm audit` identified a critical Next.js advisory affecting 16.2.6 (patched from 16.3.3); update Next.js and `eslint-config-next` together to 16.3.4 plus compatible transitive patches, verifying the resulting audit and full checks. The snapshot also captured untracked `frontend/src/app/api-contract-qa/page.tsx`, explicitly labeled a temporary API-contract test and violating raw-API import lint rules; exclude that temporary QA route from the release snapshot while preserving it in the original workspace. This is release preparation, not a product-route deletion.

### Repository evidence

| Existing behavior | Evidence | Planning consequence |
|---|---|---|
| Production Compose builds locally, uses fixed container names, and publishes 80/443 | `docker-compose.prod.yml:13`, `:43`, `:89`, `:129`, `:166`, `:203`, `:205` | Add `deploy/compose.yml`; never launch the existing production stack on this shared test host. |
| The current telemetry collector mounts Docker logs and the host root; telemetry proxy uses fixed addressing | `docker-compose.prod.yml:232`, `:239`, `:338`, `:392` | Minimal test deployment opts out of telemetry exporters/storage initially; preserve all existing telemetry files and dev/prod behavior. |
| Entrypoint migrates all non-Celery commands, collects static files, and waits without a deadline | `backend/entrypoint.sh:17`, `:28`, `:35`, `:47` | Add explicit release-mode migration control and bounded readiness waits while keeping local defaults compatible. |
| Backend image runs as django; frontend is a standalone non-root image | `backend/Dockerfile.prod:38`, `frontend/Dockerfile.prod:44`, `:47` | Reuse these Dockerfiles with targeted release fixes, never build application code on the VPS. |
| Public frontend API URL is embedded during build | `frontend/Dockerfile.prod:19`, `.env.prod.example:25` | Prefer verified same-origin `/api` so a single image remains promotable; otherwise record the build origin in its release manifest and disallow incompatible promotion. |
| Frontend has lint, Vitest, typecheck, and build scripts | `frontend/package.json:5` | CI runs all four separately and makes their failures blocking. |
| API drift check can run using a provided Python executable and compares both generated files | `scripts/api-contract.sh:15`, `:26`; `Makefile:123` | Run `API_PYTHON=python make api-check` with installed Python/Node dependencies. |
| Liveness and dependency readiness already exist | `backend/core/urls.py:22`, `backend/apps/common/observability.py:29` | Probe `/api/health/live/` and `/api/health/ready/`; do not treat dependency failure from `/api/status/` as a generic success. |
| Proxy order distinguishes NextAuth from Django API, and Django trusts forwarded HTTPS | `caddy/Caddyfile:58`, `backend/core/settings/prod.py:38` | Test NextAuth routing, secure cookies, redirects, and original HTTPS forwarding through both proxies. |
| Production requires database and signing secrets | `backend/core/settings/prod.py:4`, `:11`; `.env.prod.example:38` | Generate isolated runtime credentials and keep them only in protected host configuration. |

Line references describe the initial snapshot; implementers must accommodate parallel edits rather than overwrite them.

## RALPLAN-DR summary

### Principles

1. Preserve user work and the availability of every existing VPS service.
2. Build once from a verified commit, deploy an immutable pair of image digests, and retain release evidence.
3. Keep repository-controlled application code outside the host administration trust boundary.
4. Fail before mutation when preconditions fail; make each release state and recovery action explicit.
5. Use the smallest runtime and deployment mechanism that can be tested end to end.

### Top three decision drivers

1. Non-disruption and bounded resource consumption on an already shared VPS.
2. Demonstrable release correctness across backend, frontend, schema, migrations, and deployment orchestration.
3. Simple operation and recovery with minimal privileged automation.

### Viable options

| Option | Bounded advantages | Bounded disadvantages | Decision |
|---|---|---|---|
| A. Hosted CI builds GHCR images; restricted SSH command performs an in-place application restart in an isolated Compose project | Lowest additional memory; one stable shared-Caddy route; one set of workers/beat; small deploy script and easy digest rollback | Brief test-instance interruption; database compatibility still requires discipline; host-owned controller must be maintained | **Choose initially.** |
| B. Hosted CI builds the same images; two application slots share the isolated data services and switch their own ingress | Candidate can be probed before serving users; lower web interruption; quick traffic rollback | Duplicates application memory during releases; complicates workers/beat and proxy routing; cannot undo schema changes; consumes scarce RAM | Viable after capacity and availability needs justify it; defer for this first test instance. |

The strongest case for B is keeping the old web release live until the candidate passes real checks. The synthesis is to keep A simple while requiring candidate container smoke checks in CI, pre-pull checks, compatible migrations, and a verified previous release on the host. Neither option grants CI unrestricted Docker or root access.

## Guardrails

**Must have:** one isolated test project; independent database/cache/media volumes; fixed host-owned deployment configuration; digest-pinned backend/frontend releases; hosted blocking CI; least-privilege GitHub permissions; protected deployment environment and branch restrictions where supported; serialized deployment; explicit one-shot migrations; bounded readiness; smoke and rollback tests; sanitized evidence; unchanged unrelated VPS service inventory and routes.

**Must not have:** force-push/reset of user work; disclosure of secrets into this public repository; root credentials in agent messages, repository, or CI; membership of the deployment SSH user in the Docker group; arbitrary SSH shells, uploaded scripts, writable Compose files, or unrestricted sudo through the deployment key; host Docker socket/root filesystem/log mounts in application containers; replacing shared Caddy configuration or renaming its bind-mounted file inode; host-wide prune or Compose down; automatic database restore or reverse migrations; a duplicate live production instance in this phase.

## Task flow and ownership

Six steps: **1 discovery/snapshot → 2 runtime + 3 CI in parallel → 4 release controller → 5 hosted release and VPS bootstrap → 6 verification/recovery**. Steps 2 and 3 have separate file ownership. Later work uses the reviewed changes from both. Every implementer is working alongside others and must preserve their changes.

### 1. Freeze a safe source snapshot and bind the deployment target

**Owner:** parent/integrator. **Files:** deployment discovery evidence and final target values in deployment documentation; source snapshot handled outside this plan's ownership.

- Capture current HEAD, branch, tracked modifications, staged content, and untracked source files; secure a local recoverable snapshot before staging/pushing. Preserve ignored credentials privately, never add them to the snapshot destined for GitHub. Review staged files for secrets and exclude `.env` values, private keys, caches, generated bytecode, and task transcripts.
- Include the user's intended current source/API/observability changes in the test commit. Record the exact commit and clean checkout used by CI. Do not silently substitute the older remote HEAD or omit untracked source dependencies.
- Discover the selected test route, project and volume names, host directory, dedicated edge-network ownership, image architecture, and disk/RAM budget. Inventory baseline container IDs, health/restart counts, listeners, existing route response expectations, and shared Caddy configuration hash.
- Use private GHCR pulls with the release job's short-lived `GITHUB_TOKEN`, transported via SSH stdin and consumed only by `docker login --password-stdin` in a protected temporary Docker configuration. Remove that configuration immediately after pulling, including on failure. Never persist registry credentials in host env files or release manifests.

**Acceptance:** local recovery snapshot exists; staged public content passes a secret review; exact source SHA and complete target tuple are recorded; no discovery command changed VPS state; no unresolved target value remains when bootstrap begins. Runtime budget is recorded with at least 1 GB available RAM retained for existing services and a minimum 5 GB disk reserve before starting. The peak budget includes the additional one-shot migration container. Run the restore drill only after stopping its temporary workload; if observed capacity cannot meet the budget, do not start the test stack.

### 2. Add an isolated image-only runtime and explicit migration lifecycle

**Owner:** runtime executor. **Files:** new `deploy/compose.yml`, shared-Caddy site block template and env example under `deploy/`; targeted `backend/entrypoint.sh`, production Dockerfiles, and relevant backend tests. Existing `docker-compose.yml`, `docker-compose.prod.yml`, and `observability/` remain intact.

- Define database, Redis, backend, frontend, Celery worker and one beat process. Use project-scoped names with no `container_name`, no shared volumes, and no host-published ports. Attach only backend/frontend to dedicated external network `mobser_test_edge` with unique aliases; administrator attaches shared `search_caddy` once. Database/cache/worker/beat stay off the edge network. Verify Caddy resolves the unique aliases, never ambiguous service names. Persist its network attachment through a root-owned systemd service and timer running every minute: find the current `search_caddy`, check membership idempotently, and reconnect only if absent. Test reconnection behavior without recreating the shared stack. Document an owning-Compose external-network declaration as a future maintenance improvement.
- Use backend/frontend image digest variables; worker/beat/migration use the identical backend digest. Pin infrastructure image versions, cap service memory/CPU/pids and rotating logs within the agreed total budget, reduce worker concurrency for test capacity, and set telemetry exporters off. Keep media persistent; databases/cache are reachable only on the project's private network.
- Add release-mode behavior that disables startup migrations and runs a single explicit migration command under the deploy lock. Preserve normal developer behavior. Bound DB wait, migration execution, beat wait, and readiness. Ensure static assets exist in the runtime image or are collected deterministically without accidental migration execution.
- Preserve NextAuth `/api/auth/*` priority, Django routes, origin handling, HTTPS forwarding, and secure cookies. Set third-party integrations to isolated test values with outbound messaging disabled; do not seed public default credentials.

**Acceptance:** rendered Compose contains no build directives, fixed container names, Docker socket, host-root/log binds, public DB/Redis ports, or 80/443 ownership; all application images are digest references; all containers respect resource limits. Clean startup reaches frontend and backend readiness within 180 seconds. Migration is invoked once per release and never by backend/worker/beat startup in deployment mode. Test fixture persists across an application restart. Existing development defaults still pass their focused startup tests.

### 3. Implement hosted CI and immutable release publication

**Owner:** CI executor. **Files:** new `.github/workflows/ci.yml`, release/deployment workflow files, CI helper/tests under `scripts/` or `deploy/tests/`; frontend dependency/lockfile changes for the discovered security patches; other frontend config changes only after coordination with runtime owner.

- Run on pull requests and pushes to `master`: Python dependencies and PostgreSQL/Redis service-backed Django checks/full tests; `makemigrations --check --dry-run`; fresh migration and migration check; frontend `npm ci`, lint, Vitest, typecheck, production build; API drift check; Compose validation and deployment-controller tests. Verify the discovered Next.js advisory is resolved after coordinated dependency patches; record remaining audit findings accurately. Make one stable aggregate check fail if any required job fails or is unexpectedly skipped.
- Build actual production images and start an isolated disposable Compose test project with those images. Verify fresh migrations and critical proxy/auth routes before any deployment job becomes eligible.
- Publish backend/frontend to GHCR only for trusted `master` pushes after all gates, never for fork PRs. Use minimum job permissions and immutable action commit pins validated against official sources at implementation time. Build once; record exact source SHA, workflow/run identity, target architecture, backend/frontend digests, migration compatibility declaration, and relevant frontend build inputs in a release manifest. Label images with source/revision metadata and produce/verifiably check provenance tied to the trusted repository/workflow/ref.
- Configure a single serialized test deployment job consuming the same run's manifest and digests. Production promotion may exist as a manually dispatched workflow restricted to an already verified release; leave its environment unconfigured until a production target actually exists.

**Acceptance:** the exact source SHA passes every named hosted check; a seeded stale API artifact, failing frontend test, and migration drift each make the aggregate check fail in automated fixtures or a temporary test branch. A fork/PR workflow has no publish/deployment credentials. Successful release produces two resolvable GHCR digests and an auditable manifest. No server-side rebuild or mutable-tag selection occurs. Record actual branch/environment enforcement; do not claim unavailable GitHub plan features are enabled.

### 4. Build and test the restricted deployment controller

**Owner:** deploy executor/security reviewer in separate passes. **Files:** controller/bootstrap templates under `deploy/`, `deploy/tests/`, and `docs/deployment.md`; actual privileged bootstrap is parent-owned.

- Separate host administrator bootstrap from application release authority. Administrator installs root-owned, non-writable Compose/controller/configuration and one restricted SSH account with a dedicated key. Authorized key forces a fixed command and disables forwarding, PTY, agent/X11 forwarding and arbitrary shell access. No Docker-group membership. The forced command invokes only the fixed root-owned controller. Its sole accepted request is `deploy <run_id> <run_attempt>` with bounded numeric identifiers and fixed target `mobser-test`. The CI key cannot request rollback or select a project, path, script, image or configuration. The parent independently installs and maintains reviewed root-owned files.
- Root controller verifies the run using GitHub API data for the fixed repository: trusted `.github/workflows/release.yml`, ref `master`, event `push` or `workflow_dispatch`, requested attempt, and the exact job named `Build and verify release` is `completed` with `success`. The overall workflow may still be `in_progress` because the deployment job is executing. Fetch only the immutable artifact named `release-<run_id>-<run_attempt>` belonging to that exact run/attempt; reject duplicates, expiration, missing artifacts and unexpected archive paths. Require manifest schema `1`, SHA equal to the verified run's `head_sha`, fixed backend/frontend package names, SHA256 digest syntax, and runtime-configuration hash equal to root-installed `deploy/compose.yml` plus gateway configuration. Digest provenance means this verified run/job/artifact/source chain; it must never be inferred from a submitted tag or label alone.
- Maintain a root-owned atomic `highest_accepted` watermark using the lexicographically ordered tuple `(trusted GitHub run_number, run_attempt)` obtained from verified API data, never caller-supplied ordering values. Under the host lock, every forward request must be strictly greater than that watermark. After all authorization/artifact/configuration/capacity checks pass and before the first release mutation, atomically advance the watermark and persist candidate/stage. Only the exact currently selected manifest may return a bounded health result idempotently without rerunning migrations or changing the watermark. Administrator rollback preserves the watermark, so previously valid historical artifacts remain rejected. Failed or quarantined candidates retain their operator-review state: a higher attempt may retry only a nonquarantined failure; no larger tuple automatically clears migration quarantine. Administrator must explicitly resolve quarantine before any dependent forward deployment.
- Bound stdin token/input lengths and temporary artifact sizes; never evaluate or log tokens, artifacts, shell content or submitted env files. Token use is restricted to `api.github.com` and GHCR authentication; follow artifact redirects to the presigned download URL **without Authorization**. Use `docker login --password-stdin` with protected temporary Docker configuration, remove credentials after pulls and clean up on every exit. Root never executes files downloaded from the workflow artifact.
- Under a host lock: validate target/configuration/capacity and trusted manifest; atomically persist separate `current`, `previous`, `candidate` and `stage` state; pull the digests; back up the isolated DB when it already contains data; verify backup existence and readable archive; apply only compatible forward migrations once; restart only this project's application services; check private/public readiness and smoke; mark the candidate current only after success. Retain current and previous digest manifests and sanitized stage logs. First deploy has no previous release and must report that accurately.
- On post-migration failure, restore previous application digests only when the compatibility contract permits; do not restore data. On migration failure, leave previous application services selected and stop promotion, recording whether any migrations already applied. Incompatible changes require a separately reviewed migration sequence. Expose explicit rollback only through the administrator channel, using the stored previous manifest under the same lock and readiness checks, without lowering or clearing `highest_accepted`. The CI deployment key has no rollback command.
- Disable cancellation of an active deployment; lock both CI and host. Set overall deployment timeout to 15 minutes and readiness timeout to 180 seconds. On SSH interruption, terminate and reap child processes before releasing `flock`; a second invocation must never overlap an orphaned migration/restart. Write a migration-started marker before execution and a migration-completed marker only after success. If retry finds started without completed, quarantine that candidate for operator review rather than replay migrations automatically. A failed candidate cannot overwrite the previous known-good manifest.

**Acceptance:** automated controller tests cover malformed input, malicious digest/repository, untrusted provenance, incorrect run attempt/job/ref/event/artifact/configuration hash, credential-bearing redirect, concurrent requests, registry failure, migration failure, readiness failure, first deploy, successful promotion, previous-digest recovery, rollback failure, and interrupted retry including migration quarantine and child-process cleanup. Replay tests reject correctly signed/eligible historical artifacts, reject historical replay after administrator rollback, verify same-selected-manifest health-only idempotence, preserve the watermark across failures/rollback, allow a higher attempt only for nonquarantined failures, and require operator resolution for quarantined candidates. Rejected inputs execute zero Compose mutations. CI key cannot run `id`, read arbitrary files, upload/replace config, forward ports, or invoke unrelated Docker commands. Root wrapper/config ownership and fixed Compose project are verified on-host before release.

### 5. Bootstrap the test instance and run the actual GitHub deployment

**Owner:** parent/integrator with existing authorization. **Files:** final nonsecret host/repository setup details in `docs/deployment.md`; GitHub settings/secrets and protected VPS files are external state.

- Install reviewed controller and isolated configuration through the parent's administrative channel; do not share root credentials with workers or copy them to CI. Generate a fresh restricted CI deploy key and host-only application/DB credentials. Pin SSH host keys obtained through the trusted administrator connection. Configure GitHub repository/environment variables and the restricted key without exposing values in logs.
- Back up/hash `/root/home/ILM_SHAMELA/caddy/Caddyfile`, prepare a candidate containing only one clearly bounded test-site block appended to the existing contents, and validate that complete candidate. Update the existing bind target in place without renaming/replacing its inode; run container-side validation before reloading `search_caddy`. On failure restore saved bytes in place and revalidate/reload. The block routes NextAuth to the unique frontend alias and Django API/admin/static/media to the backend alias, preserving original HTTPS and every existing route. Add/persist only `mobser_test_edge` without recreating `search_caddy`; retain all previous network attachments. Do not launch a second public Caddy.
- Push the secured current source snapshot using normal fast-forward-compatible git operations, wait for hosted CI, then run the trusted release/deployment pipeline to the test instance. Name its eligible build job exactly `Build and verify release` and publish `release-<run_id>-<run_attempt>` only after that job has produced and verified the release images and manifest. Any failure returns to the owning executor for a focused fix and rerun; do not bypass gates to complete the demonstration.

**Acceptance:** GitHub shows a successful CI, image publish, and actual SSH deployment for one exact SHA; running backend/frontend digests match the manifest; test URL resolves with valid HTTPS and expected app/API/NextAuth behavior. Root credentials were not installed in GitHub. Existing service container IDs/restart counts and route responses match the baseline except a documented shared Caddy reload with no lost routes. Candidate project stays within the step-1 capacity budget.

### 6. Demonstrate failure recovery and publish verified operating instructions

**Owner:** independent verifier, then parent fixes or reports final evidence. **Files:** `docs/deployment.md`, sanitized CI artifacts and verification record.

- Deploy a second eligible application release, verify persisted test data, use the administrator channel to explicitly roll back to the first stored digest pair, verify functionality and data persistence, and return to the chosen final release. Run failed-readiness/migration fault injection and interrupted-migration quarantine checks in disposable CI stacks; on the VPS exercise a rejected malformed/untrusted deployment request and prove current digests remain unchanged. Never mutate unrelated services for a test.
- After stopping the temporary workload to preserve the peak resource budget, exercise an isolated restore of the generated backup into a disposable database to prove restore instructions work; production/test live DB restore remains an operator action and is never an automatic rollback step.
- Record setup, required variables and secret names, branch/environment controls, publish/deploy/rollback commands, backup retention and restore procedure, initial-deploy failure behavior, incompatibility handling, interrupted-deploy recovery, resource limits, credential rotation, teardown of only this test project, and known limitations.

**Acceptance:** independent review records pass/fail evidence for every critical release/control-plane criterion; rollback actually restores the recorded prior image digests without losing the test fixture; backup restore succeeds in isolation; no existing VPS service regressed; final URL, commit, digests, workflow URLs, smoke results, rollback evidence, and remaining limitations are delivered. No pending required check is described as complete.

## Pre-mortem: three failure scenarios

| Scenario | Early detection | Prevention and recovery |
|---|---|---|
| New test stack exhausts RAM or collides with shared Caddy, causing search/shaarawy outages | Baseline free RAM/swap, port/network inventory; capacity preflight; before/after route probes and restart counts | Minimal capped runtime, one dedicated edge network, no telemetry stack or host-wide changes; reject insufficient capacity; stop only the new project's services and restore only the saved Caddy bytes if bootstrap fails. |
| Candidate migration partly succeeds, app fails readiness, and old code cannot read the resulting schema | CI migrations and compatibility review, migration stage logs, bounded candidate smoke | Expand/contract only; snapshot isolated data; promote only after probes; roll back compatible images, never auto-restore DB; quarantine incompatible release and document operator recovery. |
| Compromised workflow input reaches privileged host commands or deploys arbitrary packages | Adversarial controller tests, provenance validation, root-owned path checks, forced-key capability probes | Fixed trusted controller/config, strict allowlist and pinned digests, no root key/Docker group, no uploaded executable/env files; reject before mutation, revoke CI deploy key, retain sanitized audit evidence. |

## Expanded test plan

| Layer | Required checks | Evidence |
|---|---|---|
| Unit | Existing Django and Vitest suites; entrypoint release flags/deadlines; controller parser/provenance/lock/state/rollback branches | Hosted test logs, exit statuses, adversarial input table. |
| Integration | PostgreSQL/Redis-backed backend suite; fresh migration plus no-drift check; production images; DB dependency readiness; worker task execution and beat heartbeat; API drift; proxy route order; image digest pairing | Disposable Compose tests using the release images, machine-readable probe results, migration records. |
| E2E | HTTPS frontend; liveness/readiness 200 with expected JSON; NextAuth session endpoint and unauthenticated protected route; login/session flow using an isolated fixture without real outbound messages; static asset retrieval; persistence across release and rollback | CI browser/HTTP smoke artifacts plus actual VPS test URL checks. Do not mark browser interaction proven by a homepage curl alone. |
| Observability | Candidate source SHA/service version in release evidence; structured app/deploy logs; health state transitions; failed release visible in GitHub; existing services and capacity before/after; no secret-bearing output | Sanitized deployment summary, service health/restart inventory and resource observations. Full Grafana/Loki/Tempo/Prometheus rollout is outside this constrained test deployment. |

## ADR

**Decision:** use hosted GitHub Actions, GHCR backend/frontend digest pairs, a host-owned restricted SSH controller, and one minimal isolated Compose test instance with in-place application restarts. Keep the existing dev/prod/observability configurations intact.

**Drivers:** shared-VPS safety, verifiable source-to-runtime provenance and release checks, operational simplicity within existing memory constraints.

**Alternatives considered:** two application slots and ingress switching; local VPS builds; unrestricted deployment user with Docker access. Two slots remain a viable follow-up. Local builds lose artifact identity and consume host resources; unrestricted Docker gives CI host-admin-equivalent authority and violates the trust boundary.

**Why chosen:** it supports an actual small-scope deployment and tested rollback without duplicating application processes or changing shared routing infrastructure on every release.

**Consequences:** short deployment interruption is accepted for the test instance; migrations must remain backward compatible; host bootstrap/controller changes require the administrator channel; observability validation initially uses existing structured logs/health and CI release evidence; a public source repository requires a source/secret review before push.

**Follow-ups:** reconsider slot switching after measuring headroom and availability needs; enable dedicated production environment only when a target is selected; add full telemetry on appropriate capacity; establish continued dependency maintenance and backup retention operations.

## Discovery items and review status

The parent must record the final host installation path and capacity limits before step 5; edge-network persistence is the one-minute root-owned systemd timer described above. Hostname and Caddy mount/route behavior are resolved above. These are code/host facts, not new user approval requests. Parent owns any cross-plan open-question log. Architect findings have been incorporated: fixed run/attempt protocol and eligible-job verification, exact immutable artifact/source/runtime-configuration binding, credential-safe redirect handling, administrator-only rollback, interrupted-migration quarantine, child cleanup before unlocking, one-minute edge-network reconciliation, and peak migration/restore resource accounting. Critic requested historical replay protection; the revision adds the root-owned trusted `(run_number, run_attempt)` watermark, preserves it across administrator rollback, limits idempotence to health on the selected manifest, and prevents higher attempts from bypassing quarantine. Mandatory Architect re-review then Critic are pending; this plan must not be described as consensus-approved before those reviews complete.

## Consensus approval
Architect iteration 2: APPROVE. Critic iteration 2: APPROVE. User explicitly requested implementation and test deployment; handoff to team execution without another approval gate.
