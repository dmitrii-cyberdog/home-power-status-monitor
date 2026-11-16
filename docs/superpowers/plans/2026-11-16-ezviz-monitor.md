# EZVIZ Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll explicitly configured EZVIZ devices using per-home credentials by
exact configured name, optionally cross-check serials, and infer each home's
electricity state from consecutive offline observations.

**Architecture:** Configuration discovers homes and their selected devices. One
EZVIZ client per home fetches the paginated account list once per round and owns
credentials and token state; a separate monitor owns offline streaks and
inferred state. An interval task replaces the cron placeholder while preserving
the existing task lifecycle and drain integration.

**Tech Stack:** Node.js 24, native ESM, existing form-encoded request service,
Node timers, `node:test`, Yarn 4.18.0. No new dependencies.

**Spec:** [EZVIZ research and agreed configuration](../../ezviz-research.md).
The conversation confirms per-home credentials and one selected camera in the
current private setup. The user clarified that NAME is the primary selector and
SERIAL is an optional additional check. Other account cameras may be returned by
the list endpoint but must not contribute observations or power inference.

## Global Constraints

- Preserve extensionless imports and the `src` working directory.
- Preserve private settings, useful comments, blank lines and unrelated work.
- Only `src/.env.example` is a tracked environment template. Documentation may
  illustrate settings; use fake names, serials and credentials everywhere in
  tracked files and tests.
- Keep monitoring disabled by default through
  `CRON_CHECK_POWER_STATUS_IS_ENABLED=0`.
- Use `POWER_CHECK_INTERVAL_SECONDS=60`, `POWER_OFF_FAILED_CHECKS=3` and
  `HOME_<id>_POWER_OFF_OFFLINE_DEVICE_COUNT=1` as defaults.
- Allow `-1` for the offline count to require all configured devices.
- Replace `CRON_CHECK_POWER_STATUS_TEMPLATE` with the interval setting for this
  task. Ignore the retired template key so existing private dotenv layers do not
  prevent startup; document that it no longer controls cadence.
- Use per-home `HOME_<id>_EZVIZ_API_APP_KEY`, `HOME_<id>_EZVIZ_API_SECRET`,
  `HOME_<id>_EZVIZ_API_BASE_URL` and
  `DEVICE_<deviceId>_HOME_<homeId>_TYPE/NAME/SERIAL`.
- Global EZVIZ credentials are obsolete and must not be used as fallbacks.
- Keep UTC observation times, unknown observations and last inferred state
  separate. State is in memory and starts unknown after restart.
- Do not implement JSON history, notifications, group queries or Xiaomi access.
- Do not contact Telegram or vendor accounts during automated verification.
- Do not commit, push, deploy, create PRs, change branches or modify remotes.
  Confirm execution location at the plan handoff; preserve the current checkout
  unless the user chooses isolation.

## Review Focus

1. Per-home tokens must not leak across homes or appear in errors/logs.
2. An API error or malformed success response must never count as offline.
3. Missing device configuration must not cause account-wide monitoring.
4. Manual and scheduled executions must not overlap or count the same round
   twice; stopping must prevent new work while draining accepted requests.
5. Unknown devices must not produce false recovery, especially with thresholds
   greater than one or `-1`.

## Task 1: Home and device configuration

**Files:** Create `src/config/monitor.js` and
`tests/unit/monitor-config.test.js`. Modify `src/config/config.js`,
`tests/unit/config.test.js`, `tests/unit/setup.js` and
`tests/unit/test-setup.test.js`.

**Interfaces:** `parseMonitorConfig(env)` returns
`{ intervalSeconds, failedChecks, homes }`. Each home contains
`{ id, name, offlineDeviceCount, ezviz, devices }`; `ezviz` contains
`{ appKey, appSecret, baseUrl }`; each device contains
`{ id, type, name, serial? }`. IDs are strings, numerically sorted and need not
be contiguous. Accept canonical positive decimal IDs without leading zeros,
within the safe integer range. Discover homes from recognized `HOME_<id>_*` keys
and device references, and devices from any recognized device field, so missing
`NAME` or `TYPE` cannot silently hide an entry. Export as `config.monitor`;
retain the existing cron enable flag at
`config.cron.checkPowerStatus.isEnabled`.

- [ ] Write failing tests for two EZVIZ devices in one home, a second home with
      different credentials, sparse IDs, exact name selection, optional serials,
      defaults, threshold `-1`, and no homes returning an empty list.
- [ ] Add invalid-input cases: missing home name, orphan device, missing type,
      label or credentials; unsupported provider; duplicate nonempty serial in
      one home; fractional/zero/non-numeric interval or failed-check count;
      threshold outside `-1` or `1..deviceCount` for homes with devices. A named
      home without devices is allowed: retain default `1` or explicit `-1`,
      reject other counts, skip provider credential requirements and return
      unknown without creating a provider client. Omitted or blank SERIAL means
      no serial cross-check. Duplicate configured names within a home require
      distinct nonempty serials for every same-name entry to avoid counting one
      physical device twice. Required strings cannot be empty/whitespace. Error
      messages name keys, never values.
- [ ] Reject obsolete home/provider fields and global EZVIZ keys with messages
      naming their replacements. Accept but ignore the retired cron template,
      including an invalid old expression; assert interval settings govern.
      Remove that template from test preload/startup fixtures. Before config
      imports, clear inherited `HOME_*`, `DEVICE_*`, `EZVIZ_*` and `POWER_*`
      variables in test setup and subprocess environment builders. Add a
      poisoned-environment subprocess test proving no configured device reaches
      a real provider. Retain dotenv precedence tests for new home settings.
- [ ] Run focused tests from `src` with
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-config.test.js ../tests/unit/config.test.js`;
      observe failures for absent parser/new settings.
- [ ] Implement parsing after dotenv loading. Validate numeric values as safe
      integers; cap interval seconds at `2147483` for Node timer range. Trim
      home display names and serials; preserve device selector names exactly.
      Keep credentials private. Require an HTTPS origin without path, query,
      fragment or credentials; initially support the user-verified Europe origin
      `https://ieuopen.ezvizlife.com` only. Do not add speculative regional
      hosts.
- [ ] Rerun focused tests; expect zero failures. Preserve existing dotenv
      precedence and test isolation.

## Task 2: Per-home EZVIZ provider

**Files:** Create `src/services/ezviz.js` and `tests/unit/ezviz.test.js`. Modify
`src/services/logger.js` and `tests/unit/logger.test.js` only to cover EZVIZ
credential redaction. Add a form-body case to `tests/unit/request.test.js`.
Reuse `src/services/requestsService` without changing its general contract.

**Interfaces:** `createEzvizClient(settings, { requestFactory, now } = {})`
returns `{ observeDevices(devices) }`. One call obtains the full account list,
then returns observations in configured-device order. Each observation contains
`{ status, observedAt, resolvedSerial?, errorCode? }`; `resolvedSerial` is
internal evidence for a uniquely matched device, excluded from routine logs.
Status is `online`, `offline` or `unknown`. `requestFactory(origin)` returns
`postXwwwForm(path, fields)`, resolving to `{ content, status, headers }` or
`{ error }`. The default factory uses `new Request(origin, '', null, 1, 10000)`;
paths include their leading slash. Tests inject transport and time; production
uses `Date.now`.

- [ ] Write failing tests for form-encoded token acquisition from
      `https://open.ezvizlife.com/api/lapp/token/get` using `appKey` and
      `appSecret`, then `/api/lapp/device/list` on the configured Europe origin
      using `accessToken`, `pageStart=0`, `pageSize=50`. Assert one list
      sequence per home per round regardless of selected-device count.
- [ ] Test token reuse, shared in-flight acquisition, per-home isolation,
      refresh within 60 seconds of expiry, and one refresh/retry on `10002`.
      Reject newly returned tokens already within the refresh margin. Validate
      returned `areaDomain` equals the configured origin; never follow arbitrary
      response URLs. A late expired response for an old token must not
      invalidate a newer cached token. Bound refresh/retry to once for the whole
      list round.
- [ ] Test multiple pages, empty account, matches on later pages, and unselected
      cameras being excluded. Require HTTP 200 and application `code: "200"`.
      Validate page index, positive size no greater than requested, nonnegative
      integer total, data array and pagination progress. Use the first total to
      bound page traversal. Request a fixed page size of 50, require echoed
      `page.page` and `page.size` to match the request, and require
      `data.length === min(50, max(0, total - pageStart * 50))`. Stop after
      `ceil(total / 50)` pages (the empty list still needs page zero). A changed
      total, repeated page, duplicate serial across pages, unexpected row count
      or failed later page makes the whole round unknown. Do not infer missing
      devices from a partial list. Device names/serials must be nonempty strings
      to resolve identity safely.
- [ ] Match `deviceName === configured.name` exactly, with case sensitivity and
      no substring/normalization fallback. Preserve configured name text; reject
      whitespace-only names without silently trimming meaningful spaces. If
      SERIAL is specified, filter the name matches by exact serial too. Exactly
      one matching record is required. A serial can disambiguate equal names but
      never select a differently named camera. Missing name, serial mismatch or
      ambiguous name yields unknown for that device. Test every case, including
      a camera renamed while its serial stays unchanged.
- [ ] Map numeric status `0/1` to offline/online. Unexpected status on a
      selected record is unknown for that device. Do not log or return
      unselected account devices or retain them after the round. Stamp
      observations when the list round completes; this is local query time, not
      a vendor freshness guarantee or atomic snapshot.
- [ ] Test malformed envelopes, transport failures, quota `10007/10029`, bad
      credentials and repeated token rejection: all selected devices are unknown
      and fetching stops for that round. Retry next round, without retry storms.
      Use fixed diagnostics `auth_failed`, `rate_limited`, `transport_error`,
      `invalid_response`, `provider_error`, `device_not_found`,
      `serial_mismatch`, `ambiguous_device` and `invalid_device_status`. Never
      include raw vendor messages or exceptions in observation results.
- [ ] Add `appkey` to logger sensitive-key suffixes. Test `appKey`,
      `HOME_1_EZVIZ_API_APP_KEY`, `appSecret` and `accessToken` using fake
      values. Capture actual transport logs as well as returned observations.
      Add a local HTTP server test for form encoding special characters; assert
      logs omit request-body values and response tokens.
- [ ] Run from `src`:
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/ezviz.test.js ../tests/unit/logger.test.js ../tests/unit/request.test.js`.
      Observe failures before implementing the provider and redaction change.
- [ ] Implement the tested client using the existing request service. Cache only
      validated tokens, fetch sequential pages, and resolve configured devices
      only after a complete validated list. No per-device info requests or video
      SDK are needed for name-based selection.
- [ ] Rerun focused tests; expect zero failures and no external calls.

## Task 3: Home power inference and polling round

**Files:** Create `src/services/powerMonitor.js` and
`tests/unit/power-monitor.test.js`. Replace `src/cron/checkPowerStatus/fn.js`'s
placeholder.

**Interfaces:** `createPowerMonitor(settings, { createClient, now } = {})`
returns `{ check() }`. `settings` is `config.monitor`; the default client
factory is `createEzvizClient`. `check()` resolves to `{ homes }`; each home
result contains `id`, `name`, `status`, `lastInferredStatus`, `lastInferredAt`,
`observedAt` and `devices`. Home statuses are `on`, `off` or `unknown`; device
statuses remain `online`, `offline` or `unknown`. Initially `lastInferredStatus`
is `unknown` and `lastInferredAt` is null; update both on each decisive round.
This timestamp is the most recent supporting check, not an electrical
transition. `observedAt` records completion of the home round. Each device
result contains its configured ID/name, observation status/time and offline
streak. Provider settings and tokens never enter results. The default export
from `fn.js` remains `log => async () => result`, delegating to one process-wide
monitor instance and logging home observations safely. `check()` coalesces
concurrent calls within this process into one polling round and applies each
observation once, including callers bypassing the scheduler. Old returned
snapshots must not mutate on later rounds.

- [ ] Write failing tests for startup unknown, no-device homes remaining
      unknown, per-device consecutive offline counts and reset on online or
      unknown. Three offline observations qualify on the third round only.
- [ ] Test a one-device home, multiple same-provider devices, independent homes,
      threshold `1`, threshold `2`, and `-1`. Other online devices must not
      override an already met positive offline threshold.
- [ ] Test recovery using `N - K + 1` online observations, with `K=N` for `-1`.
      Insufficient evidence is unknown while retaining last inferred state;
      provider errors cannot imply recovery. Prove unselected account cameras
      never affect home results and credentials are absent from results. Test
      concurrent `check()` callers, independent result snapshots, and retention
      of `lastInferredAt` during unknown rounds. For name-only selection, a
      changed resolved serial resets that device's streak before counting the
      new observation; test replacement cameras cannot inherit an old streak.
- [ ] Run from `src`:
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/power-monitor.test.js`.
      Observe failures before implementation.
- [ ] Implement per-device streaks and home inference. Call
      `client.observeDevices(home.devices)` once per nonempty home and process
      homes concurrently. Track resolved serial internally for streak identity.
      Cap streaks at `failedChecks`; unknown resets a streak. An account-list
      failure affects its own home only; other homes continue independently.
      Emit UTC observation times, not inferred physical transition timestamps.
      Keep state in memory.
- [ ] Rerun focused tests; expect zero failures.

## Task 4: Interval lifecycle, integration and documentation

**Files:** Modify `src/cron/checkPowerStatus/cron.js`,
`src/cron/checkPowerStatus/manualStart.js`, `tests/unit/cron.test.js`,
`tests/unit/startup.test.js`, `src/.env.example`, `README.md`, `AGENTS.md`,
`docs/development.md`, `docs/monitor-design.md` and `docs/ezviz-research.md`.
Update subprocess fixtures only where required by the new configuration.

**Interfaces:** Preserve task shape `{ name, execute, stop, destroy }` consumed
by the existing loader and app. Export
`createPowerStatusTask({ intervalSeconds, operation, log })` for tests; the
default scheduler supplies configuration and `fn(log)`. Use fixed interval
ticks; the first automatic round occurs after one interval. Scheduled ticks
while busy are skipped, never queued or replayed. `execute()` coalesces manual
calls into the active promise, with one result/log publication per real round.
`stop()` clears the timer and rejects new executions; `destroy()` is idempotent
and stops scheduling. Accepted rounds still use `cronService.run` so shutdown
drains them before closing agents.

- [ ] Write failing lifecycle tests using controlled clocks/operations for the
      interval, manual execution, non-overlap, errors releasing the active
      guard, no unhandled rejection, stop/destroy preventing new work and cron
      drain waiting for an active polling round. Replace placeholder assertions
      with an empty home-result assertion when no devices are configured. Use
      `t.mock.timers` or existing controlled subprocess patterns, not a real
      minute-long wait. Test the manual `fn` wrapper and task wrapper share one
      monitor state in a process, while separate launches reset state.
- [ ] Run from `src`:
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/cron.test.js ../tests/unit/startup.test.js ../tests/unit/shutdown.test.js`.
      Observe failures for the old placeholder and scheduling behavior.
- [ ] Replace expression scheduling with the interval task, preserving its
      public name and loader enable flag. Catch scheduled failures after the
      existing cron service logs them. Leave application shutdown structure
      unchanged. Ensure the manual launcher closes request agents and flushes
      logs even after an error. Preserve the existing 30-second drain and
      35-second hard shutdown deadlines. Sequential device checks can exceed
      that budget; document that accepted rounds drain only within those bounds
      and test the timeout path. Do not promise unlimited graceful completion.
- [ ] Update public examples and feature descriptions. Mark polling and
      inference implemented only after checks pass; history, alerts and bot
      status queries remain future work. Document startup validation, in-memory
      state, uncertainty, recovery, cadence migration and live acceptance
      limits. Document that a one-shot manual process starts with empty streaks:
      repeated separate launches cannot reach a three-check confirmation. An
      initial online observation may infer on immediately; initial offline
      observations remain unknown until confirmed. Keep `lastInferredStatus`
      clearly historical whenever the current result is unknown. Do not publish
      private identifiers or credentials.
- [ ] Preserve the already-configured private home name, device selection and
      credentials; do not repeat their setup. Verify key presence without
      printing values. Document the retired cron key as ignored, with removal
      optional. Keep polling disabled by default and do not start the real
      worker during automated checks.
- [ ] Run focused tests and scoped ESLint/Prettier checks. Then run from root:
      `node .yarn/releases/yarn-4.18.0.cjs test`,
      `node .yarn/releases/yarn-4.18.0.cjs lint`,
      `node .yarn/releases/yarn-4.18.0.cjs prettier`,
      `node .yarn/releases/yarn-4.18.0.cjs check`, and `git diff --check`.
      Require zero failures; inspect working-tree changes for scope/privacy.
- [ ] Review the resulting patch with fresh context, fix material defects and
      rerun affected checks. Recommend a security diff scan for the credential
      handling change; do not initiate a scan or live vendor calls implicitly.

## Plan review and execution

Review corrections: clarified empty homes, test-environment isolation, retired
cron compatibility, actual request envelopes, app-key redaction, overlapping
rounds, token refresh races, failed-account request suppression, state freshness
and shutdown/manual-run limits. Runtime implementation has not begun.

Selection is resolved: the user's latest answer makes NAME primary and SERIAL an
optional cross-check. Account-list polling replaces the earlier recommended
direct-serial approach. No additional product question remains for this scope.

Native execution is recommended: four closely connected tasks share the same
configuration and provider interfaces. It avoids a new implementation context
for each task. Subagent-driven execution remains an alternative for per-task
independent review. Confirm the execution method and current-checkout versus
isolated-worktree choice before product-code changes.

Baseline: Node.js 24.12.0, 59 tests passed, zero failures on 2026-11-16. No
implementation code has been changed by this planning step.
