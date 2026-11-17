# PM2 Restart and Status Commands Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> plan task by task after approval. Steps use checkboxes for tracking. This is a
> proposed plan, not authorization to change running processes or stored data.

**Goal:** Make Windows PM2 watch restarts graceful, explain unknown camera
observations, and separate brief status replies from formatted diagnostics.

**Execution status:** Approved and implemented locally on 2026-11-17. Tasks 1–4
are complete. Automated validation passed: 113 unit tests, syntax checks for 76
files, and scoped ESLint/Prettier checks. Independent review found no Critical
or Important issues. Approved local lock recovery and a real PM2 watch restart
were verified afterward; private configuration remains unchanged. Live provider
diagnosis and Telegram command rendering remain unverified.

The implementation also registers `/status_full` in the Telegram command menu.
The pre-existing request-transport failure was fixed by logging response status
instead of dereferencing and logging the response body. Online baseline
persistence passed regression coverage without changing the history reducer.

Minor deferred: the full reply repeats the opposite-state detection from its
summary in the history section. This does not affect the brief reply.

**Architecture:** Retain the single-writer JSON store, shared polling
coordinator, and current electricity inference rules. Add PM2 shutdown-message
handling at the process boundary and separate brief/full renderers at the
Telegram boundary. Preserve uncertain observations and recorded history.

**Tech Stack:** Native ESM Node.js 24, Yarn 4.18.0, PM2 fork mode, grammY,
Fluent, node:test.

**Spec:** User request of 2026-11-17 and the proposed behavior below; existing
contracts in `docs/monitor-design.md` remain applicable unless explicitly
changed here.

## Investigation evidence

- `src/services/monitorStore.js` exclusively creates `.monitor.lock` and removes
  it only during store close. Existing locks always block startup.
- A lock left by an exited process blocks subsequent startup until an operator
  verifies ownership and removes the stale lock.
- `src/app.js` handles SIGINT/SIGTERM but does not handle PM2's IPC `shutdown`
  message. Neither PM2 manifest enables `shutdown_with_message`. This is a
  Windows restart lifecycle gap; the exact termination path of the reported
  restart has not been reproduced.
- Shutdown awaits the rejected `runtime.monitorInitialization` promise and
  reports its startup error again as a notification drain failure.
- Polling defaults to disabled. Unknown observations do not populate decisive
  state or transition history; diagnosing them requires safe provider codes.
- `ezviz.js` produces safe diagnostic codes, but `powerMonitor.js` currently
  drops them from its device projection. This hides useful evidence about
  unknown observations.
- `/status` refreshes and persists a shared all-home round, then sends all
  diagnostic lines as plain text. `/status_full` does not exist.

## Proposed behavior and approaches

**Recommended:** Enable PM2 shutdown messages in both manifests and route them
through the existing bounded drain. Keep exclusive storage ownership
fail-closed. Recover the current stale lock only after the user approves the
concrete recovery action and all possible writers have been excluded.

**Alternative:** Automatically reclaim locks whose recorded process appears
dead. Defer this: a PID check followed by deletion is not atomic, PID reuse
complicates ownership, and concurrent recoverers can violate the single-writer
contract. This needs a separate locking design and tests if selected.

Use ECC `backend-patterns` guidance for lifecycle separation and boundary
diagnostics. No HTTP API, new provider, persistence migration, dependency, or
generic refactor is needed.

### State semantics

- An accepted online observation sets `lastDecisiveStatus=on`, updates
  `lastDecisiveAt`, and initializes `lastOn` and `stateSince` when appropriate.
- Offline observations become `off` only after the existing threshold is met.
  Unknown observations never create a transition.
- `lastOff` remains absent until an actual off baseline or transition is
  observed. Never invent past outage times from a currently online camera.
- Duration means time since detection, not proof of the physical switching time.
  Initial baselines and interrupted continuity must retain a short
  qualification.
- Keep polling disabled by default. Enabling scheduled polling is a separate
  explicit configuration action, not a silent default change.

### Reply contract

`/status [home name]` returns a small block per selected home:

```text
Family Home
Power on for 2 days 3 hours (since detection)
Last power off: 17 Nov 2026, 18:10 UTC
```

For off, reverse the state and show the last power-on detection. For no recorded
opposite state, say `Not observed`. Use minutes for short durations,
hours/minutes below one day, and days/hours thereafter; below one minute say
`less than a minute`.

For unknown/stale results, say `Power status unknown`, optionally followed by
the last confirmed state and its timestamp. Do not display a confident current
duration. For interrupted continuity with a fresh decisive sample, show the
current state and `Continuous duration unknown`.

`/status_full [home name]` retains the existing history/statistics and adds safe
device observation diagnostics. Use bold home/state headings, italic uncertainty
notes, blank lines, and plain-text divider lines. Dates are readable UTC dates.
Both commands use the same authorization, group addressing, home filtering,
refresh, and persistence semantics.

Use Telegram HTML with escaped dynamic text. Every split message must
independently contain balanced markup and complete entities; never split the
rendered HTML at an arbitrary character offset. Keep each message within a
conservative 4000-character serialized budget, including unusually long
configured names.

## Global constraints

- Preserve existing user changes, comments, private settings, grants,
  subscriptions, and home history.
- Do not delete a lock, restart PM2, enable polling, commit, push, or send live
  Telegram messages during implementation without the necessary authorization.
- Automated tests use isolated test configuration, temporary stores, and fake
  transports; no EZVIZ or Telegram requests.
- Keep English and Russian Fluent keys and variables synchronized.
- Keep one writer per storage directory and the existing 30/35/40-second
  drain/hard-exit/PM2 timeout ordering.

## Review focus

- PM2 shutdown during partial initialization must finish without releasing a
  store still in use.
- A genuine notification drain error must remain visible when duplicate
  startup-error logging is removed.
- Unknown provider responses must stay unknown and expose only allowlisted
  diagnostics, never credentials or raw responses.
- Baselines, missing opposite-state history, restarts, and gaps must not claim
  an exact physical duration.
- Long names, emoji, HTML metacharacters, multi-home output, and both locales
  must remain valid Telegram messages.

## Task 1: Windows PM2 lifecycle

**Files:** `src/app.js`, `server.json`, `server_local.json`,
`tests/fixtures/shutdown.mjs`, `tests/unit/shutdown.test.js`,
`tests/unit/pm2-config.test.js`.

- [x] Add failing tests for IPC `shutdown`, irrelevant IPC messages, repeated
      shutdown requests, and shutdown while monitor initialization is pending or
      rejected.
- [x] Assert graceful IPC shutdown exits successfully, drains once, and closes
      storage before resources. Assert startup failure exits unsuccessfully
      without a duplicate notification failure; genuine drain failures still log
      and fail.
- [x] Set `shutdown_with_message: true` in both manifests. Handle only the exact
      `shutdown` message and route it to the existing graceful shutdown path,
      classified as a normal stop.
- [x] Distinguish failed initialization from an initialized notification
      producer when draining. Preserve cleanup for initialization that completes
      during shutdown.
- [x] Run the targeted lifecycle tests; confirm all cases pass.

## Task 2: Trace unknown observations and verify persistence

**Files:** `src/services/powerMonitor.js`, `src/services/homeMonitor.js`,
`tests/unit/power-monitor.test.js`, `tests/unit/home-monitor.test.js`,
`tests/unit/power-history.test.js`.

- [x] Add failing coverage that preserves allowlisted device `errorCode` values
      through the monitor result and emits a safe diagnostic for unknown
      provider observations. Log IDs and diagnostic codes only; never raw
      provider errors, tokens, credentials, or full device responses.
- [x] Add an integration regression using a fake online camera and a temporary
      store. Assert committed `lastDecisiveStatus`, `lastDecisiveAt`, `lastOn`,
      and `stateSince`; assert `lastOff` remains null.
- [x] Cover three consecutive offline samples, recovery, unknown samples, and
      unchanged state after restart. Preserve existing inference and
      notification behavior.
- [x] Preserve device diagnostics in the monitor result and report them at the
      existing logging boundary. Do not add a persistence schema field solely
      for diagnostics.
- [x] Run the focused monitor/history tests. If the online persistence
      regression already passes, retain it and avoid changing the reducer
      without contrary evidence.

## Task 3: Brief and full Telegram status

**Files:** `src/api/bot/monitorMessages.js`, `src/api/bot/monitorCommands.js`,
`system/locales/bot/en.ftl`, `system/locales/bot/ru.ftl`,
`tests/unit/monitor-messages.test.js`, `tests/unit/monitor-commands.test.js`,
`tests/unit/bot-routing.test.js`.

- [x] Add failing renderer tests for on/off summaries, unknown/stale results,
      baseline qualifications, interrupted continuity, missing history, and
      duration boundaries at one minute, one hour, and one day in both locales.
- [x] Keep `renderStatusMessages(statuses, t)` for brief output. Add
      `renderFullStatusMessages(statuses, t)` for formatted diagnostics. Use
      small shared date/duration/escaping helpers only where both renderers need
      them.
- [x] Add `/status_full` to protected routing, optional home selection,
      addressed group commands, and localized help. Send rendered status replies
      with `parse_mode: 'HTML'`.
- [x] Keep both commands waiting for the existing shared refresh and committed
      snapshot. Expose current device diagnostics through the transient status
      projection if needed; read the existing projection callers before changing
      its return shape.
- [x] Test authorization before reads/provider checks, named filtering,
      coalesced refreshes, HTML escaping, balanced chunk boundaries, long names,
      emoji, and multi-home output.
- [x] Run focused command/renderer/routing tests, then the complete unit suite.

## Task 4: Documentation and validation

**Files:** `docs/monitor-design.md`, `docs/development.md`, `README.md` where
command/lifecycle descriptions need updating.

- [x] Document Windows shutdown-message handling, brief/full examples,
      baseline/duration qualifications, polling opt-in, and approved stale-lock
      recovery steps.
- [x] Run `node .yarn/releases/yarn-4.18.0.cjs test` and
      `node .yarn/releases/yarn-4.18.0.cjs check` from the root.
- [x] Run scoped ESLint/Prettier checks for touched files. Separate pre-existing
      failures from introduced failures.
- [x] Review the final diff against scope and existing work. Leave changes
      uncommitted.

## Live acceptance and current recovery

Approved recovery completed on 2026-11-17. The monitor was stopped with watch
disabled; the recorded owner was absent and no standalone writer was found. Only
the stale lock was removed. Home/chat file hashes were unchanged after restart
and after watch verification.

PM2 7.0.3 restored the watch configuration on an ecosystem restart without
reactivating the watcher stopped by `stop --watch`. Recreating only this app's
PM2 registration from `server_local.json`, preserving its existing environment,
restored both watch paths. Recreating a registration can change its PM2 ID.

A content-preserving modification-time change to `src/app.js` then triggered
exactly one real watch restart. Logs confirmed IPC `shutdown`, completed drain,
and application readiness without startup failure or timeout. The new lock
matched the new worker PID and the process remained online afterward. Source and
stored-data hashes were unchanged. Polling and private environment settings were
not modified.

Prepare a concrete recovery action only after implementation is reviewable. With
user approval, stop the affected PM2 app with watch disabled, verify the lock's
recorded owner and all possible writers are gone, and remove only that stale
lock. Preserve all home/chat JSON files. Apply the updated manifest so PM2
receives the new shutdown configuration.

If approved, enable local scheduled polling. Observe sanitized provider
diagnostics before deciding whether an exact-name selector, API permission,
authentication, response validation, or connectivity issue needs a separate fix.
Do not infer the camera's API status from its mobile-app availability.

Verify one real watch restart releases and reacquires storage without a loop.
Verify online camera state commits and both Telegram commands render correctly.
These checks contact live services and are separate from automated test results.

## Documentation consulted

- PM2 Windows graceful shutdown:
  https://github.com/unitech/pm2/wiki/Graceful-Start-Stop
- grammY formatting:
  https://grammy.dev/guide/basics#sending-messages-with-formatting

Current API guidance was retrieved through Context7. No application code,
private configuration, running process, or stored record was changed while
preparing this plan.
