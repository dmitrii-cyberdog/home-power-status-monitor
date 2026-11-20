# Home Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Show home-local timestamps and useful episode history in power alerts,
and send optional recurring status updates to home subscribers.

**Architecture:** Keep timestamps in UTC in storage and format them at the
notification boundary. Capture transition details with the existing durable
alert. Send status snapshots on a per-home cadence through the existing guarded
Telegram delivery path.

**Tech stack:** Node.js 24, native ESM, grammY, Fluent, Node test runner.

**Spec:** The requirements and proposed behavior below define this plan.

## Global constraints

- Home 1 uses fixed GMT+2 year-round. Other homes default to UTC and can set a
  fixed offset.
- Existing home subscriptions cover both transition alerts and recurring status.
- Interval settings use whole minutes. Zero or an omitted setting disables
  recurring status.
- Recurring and manual status use each home’s configured time zone. Recurring
  status uses the brief status layout.
- Use cached status, including its existing unknown and stale handling.
  Automated tests use fake clocks and Telegram stubs.
- Keep English and Russian message keys aligned. Preserve existing UTC history
  and queued alerts.

## 1. Add per-home settings and notification timestamps

**Files:** `src/config/monitor.js`, `src/.env`,
`src/services/monitor/messages.js`, `tests/unit/monitor-config.test.js`,
`tests/unit/monitor-messages.test.js`.

- [ ] Add config tests for Home 1 defaulting to GMT+2, other homes defaulting to
      UTC, an explicit override, and missing or zero intervals. Check rejection
      of negative, fractional, blank, unsafe or overflowing interval values and
      invalid offsets.
- [ ] Add a message test that converts `2026-11-20T23:15:00.000Z` to
      `21.11.2026 01:15:00 GMT+2`. Render the same input under another process
      time zone to catch host-local formatting.
- [ ] Run the focused config and message tests and confirm they fail for the new
      behavior.
- [ ] Add `HOME_<id>_TIME_ZONE` and `HOME_<id>_NOTIFICATION_INTERVAL_MINUTES` to
      the home config allowlist. Expose `timeZone` and
      `notificationIntervalMinutes` on each home. Accept `UTC` and fixed
      `GMT±H[:MM]` offsets up to 14 hours. Default Home 1 to `GMT+2` once it is
      discovered through existing configuration. Add commented examples to the
      shared environment template.
- [ ] Format alert timestamps from UTC using the configured fixed offset and
      append the zone label. Let the brief status renderer take a timestamp
      format for recurring messages while both manual layouts keep their
      existing date and time format. Use each home’s zone in all status layouts.
- [ ] Rerun the focused tests.

## 2. Capture and render transition history

**Files:** `src/services/power/history.js`,
`src/services/monitor/validation.js`, `src/services/monitor/messages.js`,
`system/locales/bot/{en,ru}.ftl`,
`tests/unit/{power-history,monitor-store,monitor-messages,power-notifications}.test.js`.

- [ ] Test the sequence outage at 08:00, restoration at 09:30, outage at 12:00
      UTC. Assert restoration reports the detected outage time and 1 hour 30
      minutes without power. Assert the second outage reports 2 hours 30 minutes
      with power, the previous outage time, and 4 hours between outage
      detections.
- [ ] Test a baseline outage, a transition after interrupted sampling, reversed
      timestamps, and an existing queued alert without history. Assert known
      detection timestamps remain available, unsupported durations are omitted,
      and retry after another transition renders the original snapshot.
- [ ] Run the focused tests and confirm new expectations fail.
- [ ] In `reduceHomeObservation`, capture optional delivery `history` before
      replacing `lastOn` or `lastOff`. Store nullable `previousOnAt`,
      `previousOffAt`, and `precedingStateMs`. Compute the state duration from
      the preceding detection only when sampling supports continuity and the
      elapsed time is nonnegative. Treat a baseline start as a detected bound
      and label durations as observed. Derive elapsed time between outage
      detections from the two ordered UTC timestamps, even after a gap, and
      label it as time between detections.
- [ ] Extend strict delivery validation to accept both the legacy shape and the
      new shape. Validate timestamps and durations on the new shape. Keep
      version 1 records readable.
- [ ] Add localized lines to `renderPowerAlert`. Restoration shows the detected
      outage start and observed time without power when available. Outage shows
      the observed preceding uptime, prior outage detection, and elapsed time
      between outage detections when available. Preserve baseline and
      uncertainty indicators. Format every displayed timestamp with the home
      zone.
- [ ] Rerun the focused tests.

## 3. Schedule recurring status for subscribed chats

**Files:** `src/services/monitor/runtime.js`,
`src/services/power/notifications.js`,
`tests/unit/{monitor-runtime,power-notifications}.test.js`, `README.md`,
`docs/monitor-design.md`.

- [ ] Use fake time to test disabled homes, a two-minute home and a five-minute
      home, no immediate send, and a new subscriber joining the home cadence.
      Check multiple missed intervals produce one current snapshot. Test unknown
      and stale status, unsubscribe while queued, current locale at dispatch,
      send failure, and shutdown while a send is in flight.
- [ ] Run the focused runtime and delivery tests and confirm new expectations
      fail.
- [ ] Keep each enabled home's next due time in the notification worker,
      starting one interval after notifications start. Evaluate due times with
      the injected clock and use the existing notification lifecycle with a
      check cadence of at most one minute when any interval is enabled. Update
      the due time before awaiting sends and coalesce ticks during an active
      pass. Use a single cached `homeMonitor.getStatuses()` snapshot per due
      pass. Avoid extra provider checks and leave the power polling cadence
      alone.
- [ ] Resolve recipients through
      `access.recipients(home.id, store.readChats())`. Reuse the alert dispatch
      checks for subscription identity, authorization and locale. Render the
      brief status with home-local timestamps and send it with the renderer's
      HTML mode. Keep recurring sends out of the durable transition queue. A
      failed recurring send waits until the next interval. Keep durable alert
      ordering, retry and shutdown behavior.
- [ ] Document the per-home variables, when the first update is due, the shared
      subscription, fixed GMT+2, and observed duration semantics.
- [ ] Rerun the focused tests and run the project checks.

## Verification commands

Run focused tests from `src` with the existing test bootstrap.

```sh
cd src
node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-config.test.js ../tests/unit/monitor-messages.test.js ../tests/unit/power-history.test.js ../tests/unit/monitor-store.test.js ../tests/unit/home-monitor.test.js ../tests/unit/monitor-runtime.test.js ../tests/unit/power-notifications.test.js
```

From the repository root, run `yarn test`, `yarn lint`, `yarn prettier`, and
`yarn check`.
