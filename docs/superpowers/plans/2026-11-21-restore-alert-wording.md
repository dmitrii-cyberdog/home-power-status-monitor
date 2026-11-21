# Restore Alert Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restoration alerts say when power went off and how long it was out,
marking the fallback duration as approximate.

**Architecture:** One change in `renderPowerAlert`
(`src/services/monitor/messages.js:261-308`) plus Fluent keys.

**Tech Stack:** Native ESM Node.js 24, @grammyjs/i18n (Fluent), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-restore-alert-wording-design.md`

## Global Constraints

- Restoration alerts only; outage alert output stays byte-identical.
- ru: "Было отключено в", "Электричество отсутствовало"; en: "Power went off
  at", "Power was out for". No colon after the label.
- Fallback duration prefix is exactly `≈ ` and the existing `⚠️` uncertainty
  line stays.
- Keep `en.ftl`/`ru.ftl` keys and variables synchronized, `key = value` spacing.
  Braces on every branch, blank lines between steps.
- Commit locally on `master`; never push.

## Review Focus

- `previousOffAt` later than `detectedAt` (clock moved back) → off line shown,
  no duration line.
- Baseline restoration without `previousOffAt` → neither new line.
- Known `precedingStateMs` together with `uncertain` false → plain duration, no
  `≈`, no `⚠️`.

---

### Task 1: Restore alert off time and downtime

**Files:**

- Modify: `src/services/monitor/messages.js:271-287`
- Modify: `system/locales/bot/en.ftl`, `system/locales/bot/ru.ftl`
- Test: `tests/unit/monitor-messages.test.js`

**Interfaces:**

- Produces: Fluent keys `monitor_restored_off_at`, `monitor_restored_downtime`.
  Removes `monitor_outage_detected_at` and `monitor_observed_downtime` from both
  locales if no other code uses them after the change.

- [ ] **Step 1: Write failing test**
      `'restore alerts show off time and downtime, approximate when continuity is unknown'`
      using `renderPowerAlert` with `state: 'on'`, home `timeZone: 'GMT+3'`:
  - ru, `previousOffAt` 2026-11-20T15:58:43Z, `detectedAt` 2026-11-21T12:37:50Z,
    `precedingStateMs: null`, `uncertain: true` → text contains
    `🔌 Было отключено в 20.11.2026 18:58:43`, the next line starts with
    `⏱ Электричество отсутствовало ≈ 20` (hours), and `⚠️` line present; no
    `Отключение обнаружено`.
  - en, same with `precedingStateMs: 5400000`, `uncertain: false` →
    `Power went off at`, `Power was out for 1 hour 30 minutes` (no `≈`), no
    `⚠️`.
  - en, `previousOffAt` after `detectedAt`, `precedingStateMs: null` → off line
    present, no `Power was out for`.
  - en, no `history` → neither line. Update existing restoration assertions in
    `'transition alerts show localized episode history…'` that expect the old
    labels; keep its outage assertions unchanged.

- [ ] **Step 2: Run**
      `cd src && node --import=extensionless/register --import=../tests/unit/setup.js --test ../tests/unit/monitor-messages.test.js`
      Expected: FAIL on the new wording.

- [ ] **Step 3: Implement** in `renderPowerAlert`: for
      `!outage && previousOffAt` push
      `` `🔌 ${t('monitor_restored_off_at')} ${timestamp}` ``; downtime =
      `precedingStateMs` if not null, else `detectedAt - previousOffAt` when ≥ 0
      (prefix `≈ `); push
      `` `⏱ ${t('monitor_restored_downtime')} ${prefix}${duration(ms, t, true)}` ``.
      Outage branch keeps `monitor_observed_uptime` exactly as now. Add/remove
      keys.

- [ ] **Step 4: Run** the same command, then
      `HUSKY=0 node .yarn/releases/yarn-4.18.0.cjs test`, `check`, `lint`, and
      scoped prettier. Expected: PASS.

- [ ] **Step 5: Commit** `feat: restore alert shows off time and downtime`
      (include the spec and this plan).
