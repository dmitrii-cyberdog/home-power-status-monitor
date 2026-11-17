# Telegram Access and Polling Hardening Implementation Plan

> **For implementation:** Use `superpowers:executing-plans` or
> `superpowers:subagent-driven-development`. Each task has its own regression
> tests and can be reviewed independently.

**Goal** Resolve the three selected Codex Security findings while preserving
private enrollment, group monitoring, durable alerts, and on-demand status.

**Architecture** Approve groups from a private administrator chat. Bind each
sensitive outbound message to the grant that produced it and recheck eligibility
at transport dispatch. Use the existing home monitor as the shared polling gate.

**Tech stack** Node.js 24, Yarn 4.18.0, grammY, PQueue, Fluent, and the existing
serialized JSON store. Use the repository's monitor design and the three
findings from Standard scan `c1cde0cd-7aa3-4d1f-93f8-e2a0b934aae7` as inputs.
The ECC security-review guidance applies to secret handling and authorization
checks.

## Proposed choices

| Finding                   | Recommended approach                                                                                                                | Alternative and tradeoff                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Group secret exposure     | An existing allowlisted admin issues `/authorize_group <chat_id>` in private. The target group receives a grant directly.           | Chat-bound, single-use invitations let others enroll groups without admin interaction. They add token issuance, expiry and redemption state. |
| Dispatch after revocation | Recheck the original grant or subscription immediately before each Telegram transport attempt.                                      | Cancel queued jobs on revocation. This requires an index of outstanding jobs and coordination with retry timers.                             |
| Status-triggered polling  | Share a minimum interval across cron and both status commands. A stale status request can still trigger a refresh when cron is off. | Serve cached status exclusively. This removes Telegram-triggered polling entirely and requires another source of fresh samples.              |

## Task 1 · Private group approval

**Files** `src/api/bot/adminCommands.js`, `src/api/bot/monitorCommands.js`,
`src/services/chatAccess.js`, both Fluent files in `system/locales/bot`,
`tests/unit/monitor-commands.test.js`, `tests/unit/chat-access.test.js`.

- [ ] Add regression cases for group `/secret` rejection even with the correct
      value, private `/secret` success, and private admin approval of a negative
      group ID. Cover non-admins, group-issued admin commands, positive and
      malformed IDs, repeated approval, and disabled access. Assert that no
      reply includes the supplied secret.
- [ ] Restrict `/secret` to private chats. In a group, direct members to an
      admin and keep the existing best-effort message deletion to help users
      following older instructions. Skip secret verification for group
      submissions.
- [ ] Add private, allowlisted `/authorize_group <chat_id>` using `isChatId`
      plus the negative-ID requirement. The admin must obtain the intended group
      ID from a trusted source. Add `access.authorizeGroup(chatId, locale)` and
      reuse the serialized grant write used by private enrollment. Honor the
      existing global access enablement check, preserve subscriptions on
      repeated approval, and acknowledge success after persistence. Use
      group-specific denial/help copy in English and Russian.
- [ ] Update `README.md` and `docs/monitor-design.md` with the private admin
      flow. Existing group grants continue through routine restarts. If the
      reusable secret has appeared in a group, the operator should rotate it
      after rollout and deliberately reapprove trusted groups and private chats.
      Rotation invalidates all old grants by design.

## Task 2 · Check eligibility at Telegram dispatch

**Files** `src/services/chatAccess.js`, `src/services/monitorRecords.js`,
`src/api/bot/monitorCommands.js`, `src/services/botApi.js`,
`src/services/telegramApiQueue.js`, `src/services/monitorRuntime.js`,
`src/services/powerNotifications.js`, and the corresponding unit tests for chat
access, monitor commands, the Telegram queue and power notifications.

- [ ] Add deterministic tests with a blocked queue and mocked Telegram
      transport. Assert zero downstream calls after a grant clear, a clear
      followed by a grant for the same chat, or an unsubscribe followed by a new
      subscription. Exercise revocation between a retryable response and the
      next attempt. Confirm eligible sends and ordinary unguarded API calls
      still run. Verify old registries load with existing access and preferences
      intact.
- [ ] Add a per-chat grant ID to distinguish a cleared grant from a subsequent
      approval under the same shared-secret generation. Read legacy registry
      records and backfill active identities during initialization before the
      bot starts. Assign a new ID on a new grant and preserve the ID on repeated
      approval of a current grant. Expose `access.captureGrant(chatId)` and
      `access.isGrantCurrent(chatId, grant)`, with `grant` carrying the
      generation and grant ID. Update registry validation and migration tests.
      Before rollout, confirm the rollback procedure accounts for the old
      worker's strict registry schema. A rollback that strips the new field must
      use the latest valid records and run with the worker stopped under the
      existing storage ownership rules.
- [ ] Capture the grant before refreshing `/status` or `/status_full`, and bind
      every sensitive reply to it. For notifications, use the existing
      `access.isDeliveryAllowed(delivery)` check with the original delivery
      identity. Pass a synchronous predicate to the transport using an
      operation-local `AbortSignal` as a `WeakMap` key. Use the original signal
      to look up eligibility inside the existing PQueue task just before it
      calls the downstream transport. Preserve the existing transformer order so
      `autoRetry` goes through the queue again for each attempt. Keep guard
      metadata out of the Telegram payload and retain legacy runner signal
      handling.
- [ ] Give a skipped send a distinct local result or typed error. Stop remaining
      status chunks on revocation and drop the stale alert from persistent
      delivery without recording a transport failure. Keep transient Telegram
      errors retryable and genuine blocked-chat handling intact. A request
      already sent to Telegram is outside the worker's ability to recall.

## Task 3 · Share the polling cadence

**Files** `src/services/homeMonitor.js`, `src/api/bot/monitorCommands.js`,
`src/cron/checkPowerStatus/fn.js`, `src/cron/checkPowerStatus/manualStart.js`,
`tests/unit/home-monitor.test.js`, `tests/unit/cron.test.js`, monitor command
tests, and `docs/monitor-design.md`.

- [ ] Add fake-clock tests for concurrent status and cron requests, requests
      immediately before and at the minimum interval, a non-default configured
      interval, recent unknown samples, restart with recent persisted samples,
      and a failed provider round or store write followed by repeated status
      requests. Assert provider call counts and that cached reads never advance
      inference or add another alert. Verify stale status can start a poll with
      cron disabled and the standalone operator command can force one.
- [ ] Make `homeMonitor.check({ force = false } = {})` the common entry point.
      First join any active round. Ordinary callers use a minimum of
      `Math.max(60, intervalSeconds)` seconds. Preserve the existing 60-second
      floor and honor a longer configured cadence. Keep a monotonic timestamp
      for the last started round so provider or persistence failures cannot
      create a tight loop. Use persisted wall-clock sample freshness for restart
      behavior. Future-dated samples count as stale while the in-process
      cooldown still applies. A cached reply renders the latest committed
      results and their existing timestamps.
- [ ] Call the default check from cron and both Telegram status handlers. Keep
      `{ force: true }` exclusively in the local manual launcher. Preserve
      named-home filtering, multi-home status, and the existing inference rules.
      Document the shared cadence and the operator-only refresh.

## Verification after implementation

- [ ] From `src`, run the affected files with the project test preload. Run each
      new regression against the old behavior before applying its fix, then
      rerun after the change.

  ```powershell
  Push-Location src
  try {
    node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/chat-access.test.js ../tests/unit/monitor-commands.test.js ../tests/unit/monitor-store.test.js ../tests/unit/telegram-api-queue.test.js ../tests/unit/power-notifications.test.js ../tests/unit/home-monitor.test.js ../tests/unit/cron.test.js
  } finally {
    Pop-Location
  }
  ```

- [ ] From the repository root, run `node .yarn/releases/yarn-4.18.0.cjs test`,
      `node .yarn/releases/yarn-4.18.0.cjs lint`, and
      `node .yarn/releases/yarn-4.18.0.cjs prettier`. Keep automated tests
      offline with isolated storage and mocked Telegram and EZVIZ. Review the
      final change for security regressions before rollout.
