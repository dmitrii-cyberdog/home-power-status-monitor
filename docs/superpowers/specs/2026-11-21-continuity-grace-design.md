# Continuity grace window

## Intent

After a worker restart, `/status` showed the off state with "Continuous duration
unknown" even though the outage was detected minutes earlier in the previous
run. Short gaps (restarts, EZVIZ/API failures, the `unknown` samples produced
while `POWER_OFF_FAILED_CHECKS` rebuilds) should not erase the episode duration
when the same state is confirmed again shortly after.

Today continuity requires the immediately preceding sample to be decisive, from
the same run, within twice the interval and of the same status
(`src/services/power/history.js`). Any `unknown` sample or a new run breaks it
until the next state change. A side effect: with `POWER_OFF_FAILED_CHECKS=3`,
real outage alerts are preceded by two `unknown` samples, so by our reading they
never carry observed uptime.

## Goals

- Any gap is bridged when the next decisive sample arrives within the grace
  window after the last decisive confirmation (`lastDecisiveAt`), regardless of
  run or intermediate `unknown` samples.
- The window is configurable: `POWER_CONTINUITY_GRACE_MINUTES`, default `5`.
- Bridged continuity also feeds alert `precedingStateMs` and `uncertain`.

## Non-goals / anti-goals

- Sampled totals (`onMs`/`offMs`/`uncertainMs`) keep the current per-sample
  rule; gap time stays uncertain.
- No new stored fields; record schema unchanged.
- A break that happened earlier in an episode is never repaired by a later
  bridge.
- No restart-specific logic, no seeding of offline streaks.

## Approaches

1. **Compare against the last decisive confirmation (chosen).** One rule for
   restarts and API gaps; no schema change.
2. Keep per-sample rule with exceptions for `unknown` and cross-run samples.
   Same outcome, more special cases and an extra stored field. Rejected.
3. Restore offline streaks after restart. Fixes restarts only and weakens the
   3-check rule. Rejected.

## Design

- Config (`src/config/monitor.js`):
  `continuityGraceMinutes: integer('POWER_CONTINUITY_GRACE_MINUTES', 5)`. Track
  the default in `src/.env`; document it in `docs/operations.md`.
- `createMonitorRuntime` passes it to `createHomeMonitor`, which computes
  `graceMs = max(graceMinutes * 60000, effectiveIntervalSeconds * 2000)` (never
  narrower than today) and passes it to `reduceHomeObservation`.
- Reducer, only on decisive samples:
  - `bridged = record.lastDecisiveAt !== null && time >= highWater && time - lastDecisiveAt <= graceMs`.
  - Unchanged state: `next.continuous = record.continuous && bridged`.
  - Changed state: preceding-episode continuity is
    `!baseline && bridged && record.continuous`; the new episode still starts
    with `time >= highWater`.
  - `unknown` samples no longer clear `continuous`. The per-sample `supported`
    check remains for stats only.
- `projectHomeStatus` unchanged: it still hides duration while the current
  sample is unknown, stale or from a previous run.
- Update `docs/monitor-design.md` (continuity paragraphs and alert gaps).

## Left to the builder

- Tests in `tests/unit/power-history.test.js`: restart bridged; two `unknown`
  samples then `off` carries uptime; gap over the window breaks; earlier break
  stays broken; clock reversal breaks. Config test for the new variable. Adjust
  existing expectations that relied on `unknown` breaking continuity.
