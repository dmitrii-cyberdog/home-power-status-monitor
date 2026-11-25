# Recovery Outage Statistics Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans after the design is approved. Steps use checkboxes
> for tracking.

**Goal** Add per-home outage averages and recent outage periods to the power
recovery message.

**Architecture** Persist a rolling window in the existing home JSON. Snapshot
the window on each queued recovery so retries use the data from that event.
Compute statistics from the snapshot and format them in the recipient's locale.

**Tech stack** Node.js 24, native ESM, existing JSON store, Fluent and
`node:test`.

## Proposed behavior

- Keep the latest 10 completed outages per home, newest first. Count an outage
  when the monitor detects both ends, observes continuity under the existing
  grace rules, and measures a positive duration. An initial `off` baseline has
  an unknown start. Baselines, continuity gaps and clock reversals that prevent
  measuring the outage stay out of the sample.
- Average duration, detected start time and detected restoration time over the
  same sample. Include the outage just restored if it qualifies. Show the actual
  sample size and omit the statistics block when it is empty.
- List up to five earlier outages, newest first, skipping the outage just
  restored because the alert already describes it. Omit the history heading when
  there are zero earlier outages. Each row shows two home-local timestamps and
  the elapsed duration, for example
  `❌ 24.11 13:00:55 - ✅ 24.11 21:00:55 (8 hours)`.
- Treat clock times as a 24-hour circle. `23:50` and `00:10` average to `00:00`.
  If the times cancel out, show a localized `No clear average`. Display averages
  as `HH:mm` using the same configured home offset as the history rows.
- Start legacy homes with an empty list. Cumulative totals and latest detections
  cannot reconstruct the previous ten outages. Legacy queued alerts render the
  fields they already carry.

## Approaches considered

The bounded per-home window gives recovery alerts the requested history with one
atomic write per observation. Reusing the delivery queue would lose samples once
alerts are delivered or when a home has no recipients. A separate event log
would need its own write and retention strategy.

## Global constraints

- Scope the display change to recovery alerts. Keep existing outage alerts,
  status output, inference rules and notification filters.
- Store UTC ISO timestamps. Use the existing fixed home offset for display.
- Keep `en.ftl` and `ru.ftl` keys and variables in sync. Render via the existing
  HTML line builder and chunker.
- Use isolated test configuration and fake inputs.

## Review focus

- A recovery without subscribers or with a full delivery queue still updates its
  home's history.
- A delayed or retried recovery uses its original window even after newer events
  replace the live window.
- A legacy record survives opening and writing while queued alerts stay
  readable.
- An initial off baseline, a broken continuity gap or invalid clock order does
  not enter the averages. Earlier eligible periods remain visible.
- Midnight, opposite clock times and a nonzero home offset are covered.

### Task 1. Persist completed outages and snapshot recovery history

**Files**

- Modify `src/services/monitor/records.js`, `src/services/monitor/validation.js`
  and `src/services/power/history.js`.
- Test in `tests/unit/power-history.test.js` and
  `tests/unit/monitor-store.test.js`.

**Interface** `record.recentOutages` and `delivery.history.recentOutages` are
arrays of `{ restorationSequence, startedAt, restoredAt }`. The first field uses
the existing positive recovery event sequence and the other fields are UTC ISO
strings. The delivery field is present on new recovery alerts only.

- [ ] Write reducer tests for 12 measured outages. Assert the window holds the
      newest 10 and repeated `on` observations add zero entries. Run some
      recoveries with zero recipients and one with a full queue. Assert an early
      queued recovery retains its original snapshot after all 12 cycles. Test an
      initial `off` baseline, same-time or reversed endpoints, and a gap beyond
      the continuity grace. An ineligible recovery should snapshot any earlier
      entries and leave the window unchanged.
- [ ] Write a store test opening version 1 JSON without `recentOutages` and
      containing both existing delivery shapes. Assert an empty list on read,
      then write and reopen a record with a recovery snapshot and verify both
      lists round-trip. Assert rejection of an 11-entry list, non-UTC endpoints,
      nonpositive duration, duplicate or out-of-order sequences, and a snapshot
      containing a sequence later than its recovery event.
- [ ] From `src`, run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/power-history.test.js ../tests/unit/monitor-store.test.js`.
      Expect the new assertions to fail before implementation.
- [ ] Initialize the new field and normalize missing legacy data to `[]` at the
      validation boundary. Keep the accepted legacy shapes strict. Validate the
      shared list shape, timestamp order and descending sequence order. Limit
      the sequence to the record's `eventSequence` or to the delivery's
      `sequence`, respectively.
- [ ] In `reduceHomeObservation`, after assigning the recovery sequence and
      before iterating recipients, prepend the closed episode on an `off` to
      `on` transition when `record.lastOff` is non-baseline and
      `precedingStateMs > 0`. Use `record.lastOff.detectedAt` and `observedAt`
      as endpoints. Keep the first 10 and attach the resulting array to recovery
      deliveries. Use the existing store update for the window and the delivery
      snapshot together.
- [ ] Run the same scoped tests. Expect zero failures.

### Task 2. Render recovery statistics and previous outages

**Files**

- Modify `src/services/power/history.js`, `src/services/monitor/messages.js`,
  `system/locales/bot/en.ftl`, `system/locales/bot/ru.ftl` and
  `docs/monitor-design.md`.
- Test in `tests/unit/power-history.test.js` and
  `tests/unit/monitor-messages.test.js`.

**Interface**
`powerHistory.summarizeRecentOutages(recentOutages, restorationSequence)`
returns `null` for an empty window. Otherwise it returns
`{ count, averageDurationMs, averageStartedAt, averageRestoredAt, previousOutages }`.
Average clock values are UTC ISO timestamps on an arbitrary fixed date or `null`
when the mean is undefined. `previousOutages` contains the first five entries
whose sequence differs from the delivery sequence.

- [ ] Write summary tests for UTC outages on `22.11 23:50` to `23.11 01:50` and
      `24.11 00:10` to `24.11 04:10`. Assert a count of two, three hours of
      average downtime, mean start `00:00` and mean restoration `03:00` in UTC.
      Test opposite start times `00:00` and `12:00` for a `null` mean. Test an
      empty window and a full window where all 10 entries count, only five older
      rows appear, and a recovery absent from the window still shows five rows.
- [ ] Write renderer tests for English and Russian using real Fluent strings.
      With `GMT+5:30`, assert the above mean times render as `05:30` and
      `08:30`. Verify the historical row uses `DD.MM HH:mm:ss`, local dates and
      localized duration. Verify the current outage is absent from the rows, one
      eligible outage still shows averages, and legacy, empty and outage alerts
      have no extra block. Exercise the existing HTML chunking with a long home
      name.
- [ ] From `src`, run
      `node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/power-history.test.js ../tests/unit/monitor-messages.test.js`.
      Expect the new assertions to fail before implementation.
- [ ] Implement `summarizeRecentOutages`. Average elapsed milliseconds. For each
      clock mean, convert UTC time since midnight to radians, average sine and
      cosine separately and recover the angle via `atan2`. Treat a mean vector
      length below `1e-9` as undefined. Normalize the angle to a day, round to
      the nearest minute and wrap `24:00` to `00:00`. A fixed offset can be
      applied after computing the mean because it rotates every time by the same
      angle.
- [ ] In `renderPowerAlert`, append the section for recovery alerts with a
      nonempty snapshot. Reuse the existing home-local date conversion and
      `duration` formatter. Use `monitor_recovery_outage_sample` (`$count`),
      `monitor_recovery_average_downtime` (`$duration`),
      `monitor_recovery_average_start` and `monitor_recovery_average_restore`
      (`$time`), `monitor_recovery_no_clear_average` and
      `monitor_recovery_previous_outages`. Append single-line history rows to
      the existing HTML line array. Update the persistence and alert
      descriptions in `docs/monitor-design.md`.
- [ ] Run the same scoped tests and the project `test`, `lint` and `check`
      scripts from the root via `node .yarn/releases/yarn-4.18.0.cjs`. Run
      Prettier on touched supported files. Expect zero test, lint, syntax and
      formatting failures.
