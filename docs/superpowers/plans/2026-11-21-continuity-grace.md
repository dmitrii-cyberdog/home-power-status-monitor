# Continuity Grace Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the episode duration continuous across restarts and short
`unknown` gaps when the same decisive state is reconfirmed within a configurable
grace window.

**Architecture:** The reducer decides continuity by comparing each decisive
sample with the last decisive confirmation (`lastDecisiveAt`) instead of the
immediately preceding sample. `unknown` samples no longer clear continuity.
Sampled totals keep the existing per-sample rule. The grace window comes from
`POWER_CONTINUITY_GRACE_MINUTES`, floored at twice the effective interval in
`createHomeMonitor`.

**Tech Stack:** Native ESM Node.js 24, `node:test`, Yarn 4.18.0.

**Spec:** `docs/superpowers/specs/2026-11-21-continuity-grace-design.md`

## Global Constraints

- Environment variable `POWER_CONTINUITY_GRACE_MINUTES`, default `5`.
- Effective grace is `max(minutes * 60000, effectiveIntervalSeconds * 2000)` ms.
- Stats (`onMs`/`offMs`/`uncertainMs`) behavior is unchanged.
- Record schema is unchanged; no new persisted fields.
- An earlier break in an episode is never repaired by a later bridge.
- Braces on every JS branch; blank lines between logical steps; preserve
  existing comments.
- Commit on `master` locally; do not push.

## Review Focus

- Restart while off: last pre-restart `off`, then two `unknown` (streak rebuild)
  in a new run, then `off` within 5 minutes → duration shown from the original
  detection. Test in Task 1 and Task 2.
- `unknown` lasting longer than the window, then the same state → duration
  unknown. Test in Task 1.
- Wall clock moved backward across a restart → duration unknown. Covered by the
  existing rollback tests in Task 1 (must still pass).
- Episode already broken earlier, then a bridged confirmation → still unknown.
  Test in Task 1; existing `home-monitor.test.js:323` must keep `null`.
- Invalid `POWER_CONTINUITY_GRACE_MINUTES` (`0`, `1.5`, `-1`) → startup config
  error. Test in Task 2.

---

### Task 1: Reducer continuity rule

**Files:**

- Modify: `src/services/power/history.js:1-110`
- Test: `tests/unit/power-history.test.js`

**Interfaces:**

- Produces:
  `reduceHomeObservation(record, observation, { runId, intervalSeconds, continuityGraceMs, recipients })`.
  `continuityGraceMs` is a number of milliseconds, already floored by the
  caller.

- [ ] **Step 1: Update existing tests for the new option and intended changes**

Add `continuityGraceMs: 300000` to the options of every existing reducer test,
except the `transition deliveries…` test, which uses
`continuityGraceMs: 10800000` (its old 2×5400 s floor).

Intended expectation changes:

- `history accounts sampled durations…`: `restart.continuous` becomes `true`
  (the restart is 60 s after the last `on`).
- `a new episode restores continuity after a gap…`: change the samples to
  `[0,'on'], [60,'unknown'], [420,'on'], [480,'off']` so the gap exceeds the
  window; assertions stay `record.continuous === true` and
  `pendingDeliveries[0].uncertain === true`.
- `transition deliveries…`: the 4th history entry (restart `on` at 13:00)
  becomes `precedingStateMs: 3600000`. The 5th stays `null`.

- [ ] **Step 2: Add new tests**

```js
test('a restart with streak-rebuild unknowns keeps the off duration', ...)
// run 'a': on@0, off@60 (event). run 'b': unknown@120, unknown@180, off@240.
// assert record.continuous === true, record.stateSince === iso(60000)
// assert projectHomeStatus(record, { home, runId: 'b', now: 300000,
//   intervalSeconds: 60 }).durationMs === 240000

test('unknown samples within the window keep outage uptime', ...)
// on@0, on@60, unknown@120, unknown@180, off@240
// assert pendingDeliveries.at(-1).history.precedingStateMs === 240000
// assert pendingDeliveries.at(-1).uncertain === false

test('a decisive gap longer than the window breaks continuity', ...)
// on@0, unknown@60, on@360 (6 min > 5)
// assert record.continuous === false
// then on@420 → still false (earlier break is not repaired)
```

All use `intervalSeconds: 60`, `continuityGraceMs: 300000`, one recipient as in
the existing tests.

- [ ] **Step 3: Run tests to verify the new/updated ones fail**

Run:
`node --import=extensionless/register --test tests/unit/power-history.test.js`
Expected: FAIL on the updated restart/bridge assertions.

- [ ] **Step 4: Implement the rule in `reduceHomeObservation`**

- Remove the block `if (previous && !supported) { next.continuous = false }`.
  Keep `supported` for stats only.
- On decisive samples compute:
  ```js
  const bridged =
    record.lastDecisiveAt !== null &&
    time >= highWater &&
    time - Date.parse(record.lastDecisiveAt) <= continuityGraceMs
  ```
- Unchanged state: `next.continuous = record.continuous && bridged`.
- Changed state: `next.continuous = !baseline && bridged && record.continuous`
  before building `history`; keep the trailing
  `next.continuous = time >= highWater` for the new episode.

- [ ] **Step 5: Run tests to verify they pass**

Run:
`node --import=extensionless/register --test tests/unit/power-history.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/power/history.js tests/unit/power-history.test.js
git commit -m "feat: bridge continuity across short gaps"
```

### Task 2: Configuration, wiring and docs

**Files:**

- Modify: `src/config/monitor.js:192-196`
- Modify: `src/services/monitor/runtime.js:18,37-46`
- Modify: `src/services/homeMonitor.js:3-20,60-68`
- Modify: `src/.env:34-35`, `docs/operations.md:30-31`,
  `docs/monitor-design.md:53-56,96-98,157-158`
- Test: `tests/unit/monitor-config.test.js`, `tests/unit/home-monitor.test.js`

**Interfaces:**

- Consumes: `reduceHomeObservation(..., { continuityGraceMs })` from Task 1.
- Produces: `config.monitor.continuityGraceMinutes: number`;
  `createHomeMonitor({ ..., continuityGraceMinutes = 0 })`. `0` means floor
  only, which keeps existing test fixtures that omit it working.

- [ ] **Step 1: Write failing tests**

- `monitor-config.test.js`: assert `result.continuityGraceMinutes === 5`; add
  `{ POWER_CONTINUITY_GRACE_MINUTES: '0' }` and `'1.5'` to the rejection list.
- `home-monitor.test.js`: add `continuityGraceMinutes` to `cadenceFixture`
  options and pass it to `createHomeMonitor`. New test
  `'a restart keeps the off duration within the grace window'`: fixture with
  `continuityGraceMinutes: 5`; run `'a'` checks `on` then `off` at +60 s;
  `reopen()`; run `'b'` checks `unknown`, `unknown`, `off` at +60 s each (wall
  120000, 180000, 240000) → `durationMs === 180000` (off detected at 60000, last
  check at 240000).

- [ ] **Step 2: Run tests to verify they fail**

Run:
`node --import=extensionless/register --test tests/unit/monitor-config.test.js tests/unit/home-monitor.test.js`
Expected: FAIL (missing config field, null duration).

- [ ] **Step 3: Implement**

- `monitor.js`:
  `continuityGraceMinutes: integer('POWER_CONTINUITY_GRACE_MINUTES', 5, 35791)`
  (max ≈ the interval cap in minutes; implementer's call recorded here).
- `runtime.js`: read `continuityGraceMinutes` from `config.monitor` and pass it
  to `createHomeMonitor`.
- `homeMonitor.js`: compute once
  `continuityGraceMs = Math.max(continuityGraceMinutes * 60000, effectiveIntervalSeconds * 2000)`
  and pass it to `reduceHomeObservation`.
- `src/.env`: add `POWER_CONTINUITY_GRACE_MINUTES=5` after
  `POWER_CHECK_INTERVAL_SECONDS`.
- `docs/operations.md`: table row "Max gap between equal on/off confirmations
  that keeps the episode duration continuous; at least two intervals."
- `docs/monitor-design.md`: replace "Unknown gaps interrupt continuous-duration
  claims until a new episode starts" and the "Gaps and restarts can leave
  continuous duration unknown" sentences with the grace rule; note stats still
  count gaps as uncertain.

- [ ] **Step 4: Run the full verification**

Run:

```powershell
$env:HUSKY = '0'
node .yarn/releases/yarn-4.18.0.cjs test
node .yarn/releases/yarn-4.18.0.cjs check
```

Expected: all tests pass; lint/prettier clean. If any other test fails because
it relied on `unknown` or restart breaking continuity, update it only when the
new outcome matches the spec, and list it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/config/monitor.js src/services/monitor/runtime.js src/services/homeMonitor.js src/.env docs/operations.md docs/monitor-design.md tests/unit/monitor-config.test.js tests/unit/home-monitor.test.js docs/superpowers/specs/2026-11-21-continuity-grace-design.md docs/superpowers/plans/2026-11-21-continuity-grace.md
git commit -m "feat: configure continuity grace window"
```
