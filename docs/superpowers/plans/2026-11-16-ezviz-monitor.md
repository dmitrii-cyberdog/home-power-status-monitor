# Persistent EZVIZ Home Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor configured EZVIZ devices, persist home state and statistics,
and serve secret-authorized Telegram chats with status commands and subscribed
power-off/power-restored alerts.

**Architecture:** Configuration discovers homes and their selected devices. One
EZVIZ client per home fetches the paginated account list once per round and owns
credentials and token state; a separate monitor owns offline streaks and
inferred state. A single-owner JSON store commits home state and pending alerts
atomically per home. Chat authorization and subscriptions live in a separate
registry; commands read committed snapshots and a separate dispatcher sends
durable alerts. Runtime initialization and shutdown own all these resources.

**Tech Stack:** Node.js 24, native ESM, existing form-encoded request service,
Node timers, `node:test`, Yarn 4.18.0. No new dependencies.

**Spec:**
[Approved persistent monitor design](../specs/2026-11-17-persistent-home-monitor-design.md)
(approved 2026-11-17), plus
[EZVIZ research and agreed configuration](../../ezviz-research.md). Credentials
are scoped per home. NAME is the primary selector and SERIAL is an optional
additional check. Other account cameras may be returned by the list endpoint but
must not contribute observations or power inference.

## Global Constraints

- Preserve extensionless imports and the `src` working directory.
- Preserve private settings, useful comments, blank lines and unrelated work.
- Track non-secret defaults in `src/.env`, `src/.env.dev` and `src/.env.prod`;
  ignore local overrides. Documentation may illustrate settings; use fake names,
  serials and credentials everywhere in tracked files and tests.
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
  separate. Persist historical state; current status starts unknown and offline
  streaks reset after restart. Never invalidate chat authorization on an
  ordinary restart with the same secret.
- Store versioned JSON in `volume/homes/<id>.json` and `volume/chats.json`.
  Exactly one process owns the directory. Never use names in paths.
- `TG_BOT_ACCESS_SECRET` gates each protected command and outbound alert. Secret
  rotation invalidates grants; preserve subscription preferences.
- Support `/secret`, `/status`, `/on_notification`, `/off_notification` in
  direct chats and explicitly bot-addressed commands in private groups.
- Send both confirmed outage and restoration events. Initial off baseline
  alerts; initial on baseline does not. Statistics are cumulative, not calendar
  reports. Unknown/restart gaps never count as measured on/off time.
- No Xiaomi, database, dashboard, free-form mentions, per-user roles or new
  configurable policy knobs. Preserve English/Russian key parity.
- Do not contact Telegram or vendor accounts during automated verification.
- Do not commit, push, deploy, create PRs, change branches or modify remotes.
  Preserve the current checkout unless the user chooses isolation.

## Review Focus

1. Restart, secret rotation and rotation back: preserve grants only for the
   current generation and suppress older pending alerts (Tasks 6, 8).
2. Crash or write failure: never expose uncommitted state; acknowledge the
   send-before-save duplicate window and reject competing writers (Tasks 4, 8).
3. Uncertain provider data, delayed polls and clock changes: no invented outage,
   recovery or uninterrupted duration (Tasks 2, 3, 5).
4. Subscribe/unsubscribe races and group addressing: no unintended home access
   or stale-subscription delivery (Tasks 6, 7, 8).
5. Startup/shutdown races: no polling before storage/auth initialization and no
   lock release while accepted operations can still write (Task 9).

## File and dependency map

Tasks 1-3 establish configuration, transport and pure in-memory inference. Task
4 owns disk I/O and schema validation; Task 5 owns the pure history reducer.
Task 6 owns authorization and chat subscriptions; Task 7 exposes commands and
localized rendering; Task 8 commits observations and dispatches pending alerts.
Task 9 connects lifecycle, scheduling and documentation. Execute in order.

New modules are `src/config/monitor.js`, `src/services/ezviz.js`,
`src/services/powerMonitor.js`, `src/services/monitorStore.js`,
`src/services/monitorRecords.js`, `src/services/powerHistory.js`,
`src/services/chatAccess.js`, `src/services/homeMonitor.js`,
`src/services/powerNotifications.js`, `src/services/monitorRuntime.js`,
`src/api/bot/monitorCommands.js`, `src/api/bot/monitorMessages.js` and
`src/middlewares/bot/accessHandler.js`. Existing lifecycle files are modified
only in Task 9; existing command composition and locale files in Task 7.

All test commands below run from `src`, unless marked root. Before every
implementation step, run its focused tests and observe a meaningful failure;
rerun after implementation for zero failures. Keep changes uncommitted.

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
`config.cron.checkPowerStatus.isEnabled`. Add `config.botSettings.accessSecret`
from `TG_BOT_ACCESS_SECRET`, default `''`, preserving its exact value.

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
- [ ] Test trimmed, case-insensitive duplicate home display names are rejected;
      device selectors remain exact/case-sensitive. Test missing/empty access
      secret disables protected access and dotenv precedence preserves exact
      secret text. Add `TG_BOT_ACCESS_SECRET` to test environment isolation.
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
`tests/unit/power-monitor.test.js`. Task 9 replaces the cron placeholder.

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
streak. Provider settings and tokens never enter results. This is the evidence
engine only; durable history and command snapshots belong to Tasks 5 and 8.
`check()` coalesces concurrent calls within this process into one polling round
and applies each observation once, including callers bypassing the scheduler.
Old returned snapshots must not mutate on later rounds.

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

## Task 4: Single-owner JSON storage and records

**Files:** Create `src/services/monitorStore.js`,
`src/services/monitorRecords.js`, `tests/unit/monitor-store.test.js` and
`tests/fixtures/monitor-store.mjs`.

**Interfaces:** `openMonitorStore({ directory, homeIds, fs })` asynchronously
returns
`{ readHome(id), readChats(), updateHome(id, update), updateChats(update), drain(), close() }`.
Default `fs` is Node's promise filesystem API; inject it for write-failure
tests. Reads return detached committed snapshots. Updates are serialized in one
process-wide queue: `updateHome` receives cloned `(home, chats)` and returns the
next home; `updateChats` receives a cloned registry and returns its replacement.
Updaters are synchronous and perform no network I/O. Resolve updates only after
persistence, then publish the replacement in memory. `close()` rejects new
mutations, drains accepted ones, and releases ownership.

`monitorRecords.js` exports `createHomeRecord(id)`, `createChatRegistry()`,
`validateHomeRecord(value, id)` and `validateChatRegistry(value)`. Version 1:

- Home: `version`, `id`, `sample` (null or `{ status, observedAt, runId }`),
  `lastDecisiveStatus`, `lastDecisiveAt`, `lastOn`, `lastOff` (each null or
  `{ detectedAt, baseline }`), `stateSince`, `continuous`, `trackingSince`,
  `accountedAt`, `stats: { onMs, offMs, uncertainMs, outageCount }`,
  `eventSequence`, `pendingDeliveries`, `droppedAlerts`. Initial status is
  `unknown`; dates are null until evidence exists and counters start at zero.
- Registry: `version`, `verifier` (null or `{ salt, digest }`), `generation`,
  `chats` keyed by canonical decimal chat-ID strings (including negative IDs).
  Each chat contains `authorizedGeneration`, `locale`, and `subscriptions` keyed
  by numeric home ID with `{ id }` as an opaque subscription identity.
- Delivery:
  `{ eventId, sequence, state, detectedAt, baseline, uncertain, chatId, generation, subscriptionId, locale }`.
  Event IDs combine the home ID and its monotonically increasing sequence. A
  pending entry is unique by event ID and chat ID. No device/provider
  credentials enter these records.

- [ ] Write store tests for round trips, missing files, detached reads and
      serialized mutations. Assert `readHome(id)` stays unchanged while rename
      is blocked; after simulated rename failure it is still unchanged and the
      update rejects. An invalid JSON/schema/version/ID fails opening without
      replacing the offending file. Validate dates, statuses, nonnegative finite
      counters and canonical identifiers at this disk boundary.

      ```js
      // After injecting a rename failure into an attempted home update:
      await assert.rejects(write)
      assert.deepEqual(store.readHome('1'), before)
      ```

- [ ] Test concurrent processes opening one directory: exactly one succeeds; the
      other gets an ownership error. Test orderly close/reopen, rejection of
      mutations after close, draining queued writes, startup failure cleanup,
      and stale ownership refusal. Unconfigured home files are neither loaded
      into active queries nor deleted; registry references to removed homes are
      retained but ineligible for delivery.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-store.test.js`;
      expect missing-store failures before implementation.
- [ ] Implement exclusive `volume/.monitor.lock` creation with an ownership
      token and process metadata, and same-directory temporary-file/rename
      writes. Only remove a lock owned by this instance. Do not auto-steal stale
      locks or overwrite corrupt records. Persist only validated canonical data.
      Close the lock handle before removing it on Windows. Clean up only this
      operation's temporary file after failure; do not sweep unfamiliar files.
- [ ] Rerun the focused command; expect zero failures, including controlled
      child-process ownership checks. Tests use temporary directories
      exclusively.

## Task 5: Persistent state, duration and statistics reducer

**Files:** Create `src/services/powerHistory.js` and
`tests/unit/power-history.test.js`.

**Interfaces:**
`reduceHomeObservation(record, observation, { runId, intervalSeconds, recipients })`
returns a new `HomeRecord` without mutating inputs. `observation` is a home
result from Task 3; `recipients` is an array of
`{ chatId, generation, subscriptionId, locale }`. Only history fields from Task
4 are durable; ignore the inference engine's historical fields in favor of the
previous stored record. Export
`projectHomeStatus(record, { home, runId, now, intervalSeconds })` returns
`{ id, name, status, stale, observedAt, lastInferredStatus, lastInferredAt, lastOn, lastOff, stateSince, durationMs, uncertain, stats, unobservedTailMs }`.
Use the record's last decisive state/time for `lastInferredStatus/At`.
`lastOn/Off` retain their baseline flags. `durationMs` is null when continuity
is uncertain; `unobservedTailMs` is nonnegative time after `accountedAt`, shown
separately from stored counters. Exclude delivery/authentication metadata.

- [ ] Write deterministic tests: at 60-second cadence, samples `on@0`, `on@60`,
      `off@120`, `off@180`, `unknown@240`, `on@300` produce `onMs=60000`,
      `offMs=60000`, `uncertainMs=180000`, `outageCount=1`. Use actual ISO
      fixture times in one run; expect off/on detection timestamps at 120/300
      seconds, no initial-on alert, and one event for each later transition.

      ```js
      assert.deepEqual(record.stats, {
        onMs: 60000,
        offMs: 60000,
        uncertainMs: 180000,
        outageCount: 1,
      })
      assert.equal(record.eventSequence, 2)
      ```

- [ ] Test an initial confirmed off baseline alerts and increments outages once;
      repeated off samples do neither. Unknown preserves historical state/time.
      Same-state restart adds the gap to uncertainty and creates no event;
      opposite-state restart records detection now, with an uncertain event.
      Equality at the two-interval boundary counts; larger gaps do not.
- [ ] Test clock rollback never decreases counters: retain an accounting time
      high-water mark in `accountedAt` so later recovery does not count the same
      elapsed interval twice. Backward samples break continuity. Test immutable
      earlier DTOs, stale and disabled-polling views, and old-run status always
      unknown until this process commits a sample.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/power-history.test.js`;
      expect missing-reducer failures.
- [ ] Implement the reducer and projection. Allocate elapsed intervals exactly
      once: same-run/equal-decisive-state samples within `2 * intervalSeconds`
      count toward that state; everything else is uncertain. Keep continuity
      false after a gap until a new detected state episode starts. A baseline's
      actual start is unknown. Increment event sequence only for alertable
      episodes and snapshot recipients into the same replacement home record.
      Use 1000 pending deliveries per home as a fixed cap; preserve existing
      pending entries, count/log newly dropped entries, and still commit state.
- [ ] Test cap saturation preserves statistics and existing queue order;
      clearing deliveries allows future events. Rerun focused tests; expect zero
      failures.

## Task 6: Durable secret authorization and subscriptions

**Files:** Create `src/services/chatAccess.js` and
`tests/unit/chat-access.test.js`. Extend `tests/unit/logger.test.js` for the new
secret key; retain the logger's existing metadata-only update behavior.

**Interfaces:** `createChatAccess({ store, secret, homes, now })` returns
`{ initialize(), authorize(chatId, suppliedSecret, locale), isAuthorized(chatId), setSubscription(chatId, homeId, enabled, locale), recipients(homeId, registry), isDeliveryAllowed(delivery), disableSubscriptions(chatId) }`.
`initialize`, `authorize`, `setSubscription` and `disableSubscriptions` are
async; other methods inspect committed snapshots. `authorize` returns
`authorized`, `invalid`, `disabled` or `rate_limited`. `setSubscription` returns
`enabled`, `already_enabled`, `disabled` or `already_disabled`, rejecting
unauthorized use. `recipients` filters the supplied registry snapshot inside
`updateHome` so an observation's committed recipient list is ordered against
subscription writes. `isDeliveryAllowed` also requires a currently configured
home.

- [ ] Test authorization, independent direct/group chat IDs, persistence across
      close/reopen with the same secret, and generation changes for A → B → A.
      Assert prior grants never revive on rotation back. Empty/missing secret
      disables access; repeated starts while disabled do not grant access. Auth
      initialization failure prevents all protected reads and delivery.

      ```js
      // Reopen the authorized registry with the unchanged secret, then rotate.
      assert.equal(reopenedAccess.isAuthorized('-1007'), true)
      assert.equal(rotatedAccess.isAuthorized('-1007'), false)
      assert.equal(rotatedBackAccess.isAuthorized('-1007'), false)
      ```

- [ ] Test exact secret matching, invalid attempts preserving a valid grant, and
      no plaintext secret in registry, replies or captured logs/errors. Test
      slow-verifier corruption through Task 4's validation. The verifier's
      format and work factors are fixed by schema version, not disk-supplied
      algorithm parameters. Use Node crypto's async scrypt and timing-safe
      comparison; no custom cryptography or new dependency.
- [ ] Test a maximum of five authentication attempts per chat per 60 seconds,
      including concurrent attempts. Resetting only the in-memory attempt
      limiter on restart must preserve valid grants. Expire inactive limiter
      entries; never retain a per-chat entry indefinitely solely for rate
      limiting.
- [ ] Test subscription persistence/idempotence, independent homes/chats, same
      identity on duplicate enable, new identity after disable/re-enable, secret
      rotation preserving preferences but suspending delivery, and
      old-generation pending alerts remaining invalid even after
      reauthentication.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/chat-access.test.js ../tests/unit/logger.test.js`;
      expect missing-access-service failures.
- [ ] Implement initialization before any consumer starts. Preserve salt/digest
      and generation for an unchanged secret; otherwise atomically replace the
      verifier, generate a fresh generation and clear grants while retaining
      subscriptions. Validate scrypt parameters against current Node docs when
      choosing constants. Compare supplied values without echoing them; use
      bounded errors without credential-bearing raw messages.
- [ ] Rerun focused tests; expect zero failures with no Telegram calls.

## Task 7: Authorized commands and localized status rendering

**Files:** Create `src/middlewares/bot/accessHandler.js`,
`src/api/bot/monitorCommands.js`, `src/api/bot/monitorMessages.js`,
`tests/unit/monitor-commands.test.js`, `tests/unit/monitor-messages.test.js`.
Modify `src/api/bot/index.js`, `src/api/bot/mainCommands.js`,
`src/middlewares/bot/index.js`, `src/middlewares/bot/errorHandler.js` only where
needed for secret-safe failures, `system/locales/bot/en.ftl`,
`system/locales/bot/ru.ftl`, and `tests/unit/bot-routing.test.js`.

**Interfaces:** `createBotRoutes({ access, homeMonitor })` replaces the static
route export; callers inject services. `createAccessHandler({ access })` gates
protected commands. `createMonitorCommands({ access, homeMonitor })` returns a
Composer. `homeMonitor.getStatuses()` returns Task 5 DTOs in numeric ID order;
Task 7 tests stub this interface until Task 8 implements it.
`renderStatusMessages(statuses, t)` and `renderPowerAlert(delivery, home, t)`
return plain-text message arrays. No provider call occurs in a command.

- [ ] Consult Context7 for current grammY command addressing, argument
      extraction, i18n translation outside a handler and Telegram API error
      shapes before coding those boundaries. Resolve the library ID first.
      Verify group command privacy/deletion requirements against official
      documentation if not covered.
- [ ] Extend the existing `Bot.handleUpdate` fixture with stubbed bot info and
      API transformer. Test direct `/secret`, protected denial without leaking
      home names, authenticated `/status` and `/status Family Home`, and group
      `/status@power_test_bot Family Home`. Ignore bare group commands,
      free-form mentions, unrelated messages and commands for another bot.
      Generic start/help remain public. Changing the group chat ID requires a
      new grant.

      ```js
      // Fixture replies from an unauthorized /status; home name is a sentinel.
      assert.equal(replies.length, 1)
      assert.doesNotMatch(replies[0].payload.text, /Family Home/)
      assert.equal(providerCalls, 0)
      ```

- [ ] Test different group members share chat authorization and subscription
      scope. Test all-home numeric order, trimmed case-insensitive lookup,
      unknown/missing home arguments, notification command idempotence and no
      success acknowledgement on failed persistence. Preserve secret arguments
      exactly after the command separator; do not apply home-name normalization
      to them. Verify access for every protected command, not just `/status`.
- [ ] Test initial/unknown/stale/baseline/gapped DTO rendering, UTC labels,
      duration estimates, on/off/uncertain totals and outage count in both
      languages. Assert locale keys/variables match. Split plain text to at most
      4000 UTF-16 code units without breaking a surrogate pair; handle a single
      unusually long home name as well as long all-home replies.
- [ ] Test best-effort deletion of `/secret` messages on success and failure;
      failure to delete neither changes the auth result nor logs raw errors or
      message content. Capture handler/error logs with sentinel secrets and
      verify absence. Public help must not claim that implemented features are
      still future work once the final integration ships.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-commands.test.js ../tests/unit/monitor-messages.test.js ../tests/unit/bot-routing.test.js ../tests/unit/bot-error-handler.test.js`;
      expect absent-command failures.
- [ ] Implement the factory composition, public secret handler, protected routes
      and pure message renderers. Use the existing i18n middleware; persist the
      supported locale on authorization/subscription changes for later alerts.
      Update all callers of the old static routes export, including tests.
- [ ] Rerun focused tests; expect zero failures and no external requests.

## Task 8: Committed monitoring rounds and durable alert delivery

**Files:** Create `src/services/homeMonitor.js`,
`src/services/powerNotifications.js`, `tests/unit/home-monitor.test.js` and
`tests/unit/power-notifications.test.js`.

**Interfaces:**
`createHomeMonitor({ monitor, store, access, homes, runId, intervalSeconds, now, log })`
returns `{ check(), getStatuses() }`. `check()` coalesces the entire
observation-and-commit operation, calls Task 3's monitor, and uses Task 4's
`updateHome` with Task 5's reducer and Task 6's recipient selection. It returns
committed public statuses only. Commit each home independently; one disk failure
does not prevent healthy homes committing, but reject/report the failed round
after other commits settle. All command reads use the same instance and
projections.

`createPowerNotifications({ store, access, homes, send, translate, log })`
returns `{ flush(), stop(), drain() }`. `send(chatId, text)` uses the existing
configured Telegram API; `translate(locale)` supplies the renderer's `t`.
`flush()` coalesces concurrent passes, making at most one transport submission
per eligible delivery per pass; the existing transport owns bounded retries.
`stop()` prevents new passes/submissions; `drain()` waits for accepted work and
its acknowledgement writes.

- [ ] Test concurrent scheduled/manual checks commit one observation once;
      failed writes leave query snapshots and pending events unchanged. Pending
      alerts never become visible before a home commit. A subsequent successful
      observation can recover without duplicating earlier committed events.
      Rename homes without losing history/subscriptions; omit removed homes.
- [ ] Test both event types, initial-off baseline, no initial-on alert, no
      replay on subscribe, and two subscribed chats with independent delivery
      outcomes. Unknown provider rounds do not prevent retries of already
      pending alerts. A disabled Telegram transport leaves pending records
      untouched.
- [ ] Test event order per home/chat across restart: a failed earlier event
      blocks later events for that pair only. Flush other recipients
      concurrently with a fixed maximum of four active pairs, sharing the
      existing API queue. A hung send for one pair must not block polling or
      already running pairs.
- [ ] Test revocation before sending, old-generation rejection, removed-home
      rejection and disable/re-enable identity races. Successful delivery
      removes only that event/chat entry; concurrent observation commits cannot
      lose newer events. Invalid recipients are removed durably without sending.

      ```js
      // With one pending event whose subscription has been disabled:
      await notifications.flush()
      assert.equal(sent.length, 0)
      assert.equal(store.readHome('1').pendingDeliveries.length, 0)
      ```

- [ ] Test temporary failure stays pending; definite blocked/removed-chat errors
      disable all that chat's subscriptions and discard its pending deliveries
      on subsequent validation. Classify documented API errors conservatively:
      unrelated permanent-looking response errors must not revoke access or
      subscriptions. Do not log raw transport messages containing sensitive
      data.
- [ ] Test crash simulation after send-before-ack: reopen the store and observe
      possible repeat delivery with the same event ID. Ack write failure stops
      further events for that pair in this pass. Test cap/drop counter behavior
      under sustained failures, stop/drain, and no unhandled rejections.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/home-monitor.test.js ../tests/unit/power-notifications.test.js`;
      expect missing-service failures.
- [ ] Implement the coordinator and independent dispatcher. Never hold the store
      mutation queue across a network call. Recheck authorization/subscription
      immediately before each submission; an already submitted request cannot be
      recalled. An event whose send is confirmed but whose ack is unsaved is
      still pending: document the at-least-once, bounded-queue guarantee
      honestly.
- [ ] Rerun focused tests; expect zero failures, using only fake transports.

## Task 9: Runtime ownership, interval lifecycle and final verification

**Files:** Create `src/services/monitorRuntime.js` and
`tests/unit/monitor-runtime.test.js`. Modify `src/app.js`,
`src/loaders/index.js`, `src/loaders/bot.js`, `src/loaders/cron.js`,
`src/cron/checkPowerStatus/fn.js`, `src/cron/checkPowerStatus/cron.js`,
`src/cron/checkPowerStatus/manualStart.js`, `tests/unit/cron.test.js`,
`tests/unit/startup.test.js`, `tests/unit/shutdown.test.js`,
`tests/unit/bot-runner.test.js`, `tests/fixtures/worker.mjs`,
`tests/fixtures/shutdown.mjs`, `src/.env`, `src/.env.dev`, `src/.env.prod`,
`README.md`, `AGENTS.md`, `docs/development.md`, `docs/monitor-design.md` and
`docs/ezviz-research.md`.

**Interfaces:** `createMonitorRuntime({ config, directory, now, log, ...deps })`
asynchronously opens/validates storage, creates a fresh run ID, initializes
access and assembles the services. Dependency injection is for tests only;
production directory comes from `config.generalSettings.externalStorageFolder`.
Returns
`{ access, homeMonitor, setTelegramApi(api), startNotifications(), stopNotifications(), drainNotifications(), close() }`.
`setTelegramApi` wires one dispatcher to the API configured by
`configureTelegramApi`; it does not start delivery. Notification passes start
immediately and then every monitor interval, independently of polling
enablement; busy passes coalesce. Without an API there is no delivery timer.
`close()` is called only after producers have stopped and drained, then
drains/releases storage.

The loader stores this object as `runtime.monitorRuntime` before starting cron
or Telegram. Pass it explicitly to `botLoader(signal, monitorRuntime)` and
`cronLoader(monitorRuntime)`; keep the bot loader's runner return contract.
Register all public commands, compose injected routes, and attach the bot API
before starting notifications. Check shutdown signal around async initialization
so a late startup continuation cannot start producers or leak storage ownership.

`fn(log, homeMonitor)` returns `async () => result`, delegating to the shared
coordinator. `createPowerStatusTask({ intervalSeconds, operation, log })`
returns `{ name, execute, stop, destroy }`. The configured factory receives
`monitorRuntime.homeMonitor`; no import-time singleton opens storage or starts
work. The first automatic poll occurs after one interval. Busy ticks skip;
manual execute coalesces; stopping rejects new work and drains accepted rounds
through `cronService.run`.

- [ ] Write controlled lifecycle tests for timer cadence, non-overlap, manual
      coalescing, errors releasing guards and stop/destroy behavior. Test cron
      drain waits for persistence as part of each accepted round; do not sleep
      for real minute-long intervals.
- [ ] Test initialization order: store lock/schema → secret initialization →
      producers. Corrupt files, changed-secret save failure and competing manual
      processes cannot start provider calls or protected bot routes. Cover an
      abort during initialization and a failure after partial startup.

      ```js
      // A fake access initializer rejects before any producer can start.
      await assert.rejects(startup)
      assert.equal(providerCalls, 0)
      assert.equal(telegramCalls, 0)
      ```

- [ ] Test shutdown order: stop intake/timers → drain bot/cron/notification work
      and acknowledgement writes → drain Telegram queue → close store → close
      agents/flush logs. Preserve the 30-second drain and 35-second hard limit.
      Include hanging notification/write cases in the existing VM fixture. On
      timeout, terminate with failure without releasing a lock while old work
      can still write; leave the lock for documented stale-lock recovery.
- [ ] Update subprocess fixtures to use temporary working directories laid out
      with `src`, `system/locales` and `volume`, or inject a temporary store
      into the controlled loader. Never write test records into the real
      `volume`. Clear inherited provider/secret variables and disable real
      transports.
- [ ] Run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-runtime.test.js ../tests/unit/cron.test.js ../tests/unit/startup.test.js ../tests/unit/shutdown.test.js ../tests/unit/bot-runner.test.js`;
      expect missing-runtime or old-lifecycle assertions to fail.
- [ ] Implement explicit runtime ownership and replace expression scheduling.
      The standalone manual launcher acquires the same exclusive store, runs one
      check and closes resources; refuse if the worker owns the directory. Do
      not attach Telegram or start notification timers in that launcher. It can
      persist newly detected events for a later worker but cannot send. Separate
      launches reset inference streaks, never authorization/history.
- [ ] Update public docs/examples and the env template with empty access secret,
      new home/device settings and disabled polling. Explain command addressing,
      per-chat/group access, persistent grants, secret rotation, both alerts,
      cumulative estimates, uncertainty, initial baselines, storage ownership,
      stale-lock recovery after checking the prior process is gone, manual-run
      limits, bounded retries/drop counts and the send/ack duplicate window.
      Update old future-only descriptions once implementation checks pass.
- [ ] Rerun focused lifecycle tests and all new service tests; expect zero
      failures. Run scoped ESLint/Prettier checks for touched files.
- [ ] Run from root: `node .yarn/releases/yarn-4.18.0.cjs test`,
      `node .yarn/releases/yarn-4.18.0.cjs lint`,
      `node .yarn/releases/yarn-4.18.0.cjs prettier`,
      `node .yarn/releases/yarn-4.18.0.cjs check`, and `git diff --check`.
      Require zero failures and inspect the patch for private data/scope
      changes.
- [ ] Review the complete implementation with fresh context, address material
      issues and rerun affected checks. Recommend a security diff scan for the
      credential/access changes; do not launch a scan or live acceptance without
      authorization. No commits, pushes, PRs or deployments are part of this
      plan.

## Plan review and execution

Design approved 2026-11-17. The plan retains the original provider/inference
contract and adds durable state/statistics, persistent secret-based chat grants,
status/subscription commands, both alert types and lifecycle ownership. All
implementation tasks remain unchecked; this revision changes docs only.

Self-review covers the approved design against Tasks 1–9, including unchanged-
secret restarts, rotation back, unknown/statistical gaps, single-writer safety,
per-chat authorization, subscription races, durable retry ordering and bounded
shutdown. Task 7 reads status DTOs from Task 8's declared interface; its tests
stub that interface until integration. No runtime opens storage at import time.

Native execution in the current checkout is recommended because these nine
ordered tasks share storage and lifecycle interfaces. Subagent-driven execution
is available if per-task independent implementation/review is preferred. Review
this plan and select the execution method before product-code changes; preserve
the existing checkout unless isolation is requested.

Historical baseline only: Node.js 24.12.0 and 59 passing tests were recorded on
2026-11-16. Re-establish the current baseline at execution; those results are
not verification of this expanded implementation.
