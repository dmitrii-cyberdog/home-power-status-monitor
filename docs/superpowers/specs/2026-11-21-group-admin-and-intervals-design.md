# Group administration, per-chat intervals and status wording

## Intent

The operator wants to manage approved Telegram groups from the private bot chat
without anything being posted to those groups: see which groups are connected,
switch their notifications on/off, change their recurring status interval and
delete them. Groups keep their own controls. Separately, the brief status
wording should read naturally.

## Goals

1. Brief status wording (`/status` and recurring status messages).
2. Admin `/groups` list with per-group on/off and delete buttons, plus typed
   `/group_on`, `/group_off`.
3. Per-chat recurring interval per home, set in the chat itself
   (`/notification_interval`) or by the admin (`/group_interval`).

All admin actions are silent towards the affected group.

## Non-goals / anti-goals

- No leaving groups on delete; the bot stays a member.
- No persisted recurring schedule; restarts reset per-chat timers as today.
- `/status_full` labels and alert texts keep their current wording.
- Admin commands stay private-chat only and are not added to `setMyCommands`.
- Anti-goal: any admin action that sends a message to the affected group.

## Constraints

- Native ESM, grammY, existing `Composer` patterns in `src/api/bot`.
- `volume/chats.json` must stay readable by validation; older registries without
  the new field remain valid. Writes go through `store.updateChats`.
- English and Russian Fluent keys stay synchronized.
- Telegram callback data ≤ 64 bytes.
- No Telegram/provider calls in automated tests (fake `ctx.api`).

## Approaches (decided)

1. Group names: **fetch live via `getChat` when `/groups` runs** (chosen) vs
   storing titles when a group uses the bot (stale, missing for groups approved
   remotely).
2. Interval storage: **separate `intervals: { <homeId>: minutes }` on the chat
   entry** (chosen; survives on/off) vs inside the subscription entry (reset by
   every toggle).
3. Cadence: **in-memory anchors per chat and home** (chosen; same as today) vs
   persisted next-due times (extra writes, unnecessary).

## Design

### 1. Status wording

Brief rendering only (`summaryLines` with `brief = true`):

```
⚡️ Электричества нет ❌
⏱ …duration or continuity line…

🕒 Отключение света обнаружено в 20.11.2026 18:58:43 (местн. вр.)

✅ До этого свет включали 20.11.2026 07:01:42 (местн. вр.)
```

New keys (no colon after the label; the timestamp follows a space):

| Key                    | ru                            | en                             |
| ---------------------- | ----------------------------- | ------------------------------ |
| `monitor_detected_off` | Отключение света обнаружено в | Power outage detected at       |
| `monitor_detected_on`  | Включение света обнаружено в  | Power return detected at       |
| `monitor_before_on`    | До этого свет включали        | Before that, power came on at  |
| `monitor_before_off`   | До этого свет отключали       | Before that, power went off at |

- The detection line uses the key for the shown state (current state, or the
  last known state in the unknown branch). Baseline suffix is kept.
- In the known-state branch a blank line separates the detection line and the
  "before" line. Missing history still renders `monitor_not_observed`.
- `/status_full` keeps `monitor_since`, `monitor_last_on`, `monitor_last_off`.

### 2. Admin group management (private chat, admins only)

- `/groups`: lists chats whose ID is negative and whose grant is current
  (`authorizedGeneration === generation`). One message per group:
  - title from `ctx.api.getChat(id)`; on any error show the ID with
    "unavailable"; no group → "no connected groups" reply;
  - per configured home: on/off state and effective interval (chat override,
    else home default, `0` shown as "no recurring updates");
  - inline keyboard: one toggle button per home (`grp:on|off:<chatId>:<homeId>`)
    and a delete button (`grp:del:<chatId>`).
- Toggle callback: re-checks admin + private chat, calls
  `access.setSubscription`, answers the callback with the result and edits that
  message's text and keyboard in place.
- Delete callback: edits the message to "Delete group <title>?" with Yes
  (`grp:delok:<chatId>`) / Cancel (`grp:cancel:<chatId>`). Yes calls
  `access.clearChats(chatId)` and edits the message to "deleted"; Cancel
  restores the group view. Pending alerts for that chat are skipped by the
  existing dispatch guard.
- `/group_on <chat_id> [home]`, `/group_off <chat_id> [home]`: same effect as
  the buttons. Without a home, they apply to all configured homes.
- Non-admin or non-private use: existing `admin_access_denied` behaviour
  (non-private silently ignored, as other admin commands).
- `/admin` help lists the new commands.

### 3. Per-chat recurring interval

- Chat entry gains optional `intervals`: object of home ID → integer minutes,
  `0` or `5..10080`. Validation accepts entries with or without the field.
  `createChatEntry` does not add it; it appears on first set.
- Effective interval =
  `chat.intervals?.[homeId] ?? home.notificationIntervalMinutes`.
- `access.setInterval(chatId, homeId, minutes)` (authorized chats, known homes)
  and `access.recipients` include `intervalMinutes` (effective) per recipient.
- `/notification_interval <minutes> [home]` (protected command, any authorized
  chat, addressed form in groups): home optional when exactly one home exists.
  Invalid value → usage reply with the allowed range.
- `/group_interval <chat_id> <minutes> [home]` (admin, private): silent; without
  a home it applies to all homes.
- Reset (my call): the value `default` instead of minutes removes the chat's
  override for that home (and the `intervals` object when empty), so the chat
  follows `HOME_<id>_NOTIFICATION_INTERVAL_MINUTES` again.
- The 5-minute minimum applies only to chat-set values (agreed); the env home
  default keeps its current range.
- Notifications: cadence keyed by `${chatId}:${homeId}` holding
  `{ intervalMs, anchor }`. A change in effective interval re-anchors at the
  current time. Recipients with effective `0` are skipped. Cadences for chats
  that are no longer recipients are dropped.
- Runtime: the per-minute recurring timer runs whenever
  `60 % intervalSeconds !== 0` (no longer conditional on home defaults), because
  any chat may set an interval.
- `notification_interval` is added to `setMyCommands`.

### Argument rules (my calls)

- `[home]` is the home name, matched trimmed and case-insensitively like the
  existing `/status <home>`; everything after the fixed arguments is the name,
  so names with spaces work. Unknown name → `monitor_not_found`.
- `/group_on`, `/group_off`, `/group_interval` accept only negative chat IDs
  (like `/authorize_group`); otherwise usage reply. A group that is not approved
  in the current generation → "group not found" reply.

### Docs

Update `docs/monitor-design.md` (Telegram access/recurring updates) and
`docs/operations.md` (commands), and English/Russian help texts.

## Left to the builder

- Exact Fluent wording for new admin/interval replies (both locales).
- Message layout details of `/groups` entries beyond the fields above.
- Test placement; must cover: wording in both states/locales; group listing
  incl. unavailable title; toggle/delete/cancel callbacks incl. non-admin;
  interval validation, persistence, legacy registry, cadence per chat,
  re-anchoring and `0`.
