# Restore alert wording

## Intent

The restoration alert should say when power went off and how long it was out,
instead of a bare "outage detected" timestamp.

## Design (small change)

`renderPowerAlert` in `src/services/monitor/messages.js`, restoration
(`state === 'on'`) only, when `history.previousOffAt` exists:

```
🔌 Было отключено в 20.11.2026 18:58:43 (местн. вр.)
⏱ Электричество отсутствовало 20 часов 39 минут
```

- Off line: new key `monitor_restored_off_at` — ru "Было отключено в", en "Power
  went off at"; no colon, timestamp follows a space. Replaces
  `monitor_outage_detected_at` in the restoration alert.
- Duration line: new key `monitor_restored_downtime` — ru "Электричество
  отсутствовало", en "Power was out for"; value `duration(ms, t, true)`.
  - `precedingStateMs` known → that value, shown plainly.
  - Otherwise `detectedAt - previousOffAt` when ≥ 0, prefixed with `≈ `; the
    existing `⚠️ monitor_uncertain` line stays.
  - Negative or missing → no duration line.
- The old `monitor_observed_downtime` line is no longer emitted for restorations
  (the new line replaces it). Outage alerts unchanged.
- Keys added to both locales; unused keys removed only if nothing else uses
  them.

## Approaches

Approximate vs. plain fallback: user chose approximate (`≈`, keep ⚠️).

## Tests

ru and en restoration alert with known downtime (plain), unknown continuity (≈ +
⚠️), and missing `previousOffAt` (no off/duration lines); outage alert output
unchanged.
