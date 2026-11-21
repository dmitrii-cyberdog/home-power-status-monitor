# Group Administration and Per-Chat Intervals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** New brief status wording, silent admin management of approved groups
(`/groups` list, on/off, delete), and per-chat recurring status intervals.

**Architecture:** Wording lives in `messages.js` + Fluent files. Chat-level
interval overrides are stored in `chats.json` (`intervals`) and exposed by
`chatAccess`; the notification worker keeps one in-memory cadence per chat and
home. Admin group UI is a new grammY composer next to `adminCommands.js`.

**Tech Stack:** Native ESM Node.js 24, grammY, @grammyjs/i18n (Fluent),
`node:test`, Yarn 4.18.0.

**Spec:**
`docs/superpowers/specs/2026-11-21-group-admin-and-intervals-design.md`

## Global Constraints

- Admin actions never send a message to the affected group.
- Chat-set interval values: `0` or integers `5..10080`; `default` removes the
  override. Env home default keeps its current range.
- `[home]` = home name, trimmed, case-insensitive, rest of the text; optional
  only when exactly one home is configured.
- `/group_on`, `/group_off`, `/group_interval` accept only negative chat IDs
  (`monitorValidation.isChatId(x) && x.startsWith('-')`).
- Older `chats.json` without `intervals` stays valid. Stored alert deliveries
  must not gain new fields (they spread `access.recipients` output).
- Keep `en.ftl`/`ru.ftl` keys and variables synchronized.
- No real Telegram calls in tests (fake `bot.api.config` transformer).
- Braces on every branch, blank lines between steps, two `//` lines between
  major sections, preserve comments. Commit locally on `master`; never push.

## Review Focus

- A chat with an override, then the env default changes → override wins; after
  `default` → env default applies. Test in Task 2.
- Interval changed while a cadence is running → next update one new interval
  after the change, not immediately. Test in Task 3.
- Admin taps a button on an old `/groups` card for a group deleted meanwhile →
  "group not found", no registry write. Test in Task 5.
- `getChat` fails (bot kicked) → card still rendered with ID and "unavailable".
  Test in Task 5.
- Non-admin or callback from a group chat → refused, no state change and no
  message to the group. Test in Task 5.

---

### Task 1: Brief status wording

**Files:**

- Modify: `src/services/monitor/messages.js:66-137`
- Modify: `system/locales/bot/en.ftl`, `system/locales/bot/ru.ftl`
- Test: `tests/unit/monitor-messages.test.js`

**Interfaces:**

- Produces: Fluent keys `monitor_detected_off`, `monitor_detected_on`,
  `monitor_before_on`, `monitor_before_off` (values in the spec table).

- [ ] **Step 1: Write failing tests** (new test
      `'brief status uses state-specific detection and previous-change wording'`):
      render `renderStatusMessages` for an `off` home with `lastOff`/`lastOn` in
      `ru` and `en`, and an `on` home in `en`. Assert, joined text contains:
  - ru off: `🕒 Отключение света обнаружено в 20.11.2026 18:58`, then an empty
    line, then `✅ До этого свет включали 20.11.2026 07:01`;
  - en off: `Power outage detected at`, `Before that, power came on at`;
  - en on: `Power return detected at`, `Before that, power went off at`;
  - `renderFullStatusMessages` for the same home still contains `Last power on:`
    and `Detected:` (unchanged). Update existing brief-status assertions that
    expect `Detected:` / `Last power on:` in brief output.

- [ ] **Step 2: Run**
      `node --import=extensionless/register --test tests/unit/monitor-messages.test.js`
      Expected: FAIL on the new wording.

- [ ] **Step 3: Implement.** `sinceLines` uses
      `` `🕒 ${t(`monitor_detected_${state}`)} ${statusEpisode(...)}` `` (no
      colon). In the known-state branch of `summaryLines`, when `brief` is true
      the opposite line becomes
      `` `${icon} ${t(`monitor_before_${opposite}`)} ${timestamp(...)}` ``
      preceded by `['']`; when `brief` is false keep the existing
      `monitor_last_*:` line. Add the four keys to both `.ftl` files.

- [ ] **Step 4: Run** the same command. Expected: PASS (includes the existing
      locale-key parity test).

- [ ] **Step 5: Commit** `feat: clearer brief status wording`.

### Task 2: Per-chat interval storage

**Files:**

- Modify: `src/services/monitor/validation.js:109-135`
- Modify: `src/services/chatAccess.js`
- Test: `tests/unit/chat-access.test.js`, `tests/unit/monitor-store.test.js`

**Interfaces:**

- Produces:
  - `access.setInterval(chatId: string, homeId: string, minutes: number | null): Promise<void>`
    — throws `Error('Access denied')` like `setSubscription` for unauthorized
    chats or unknown homes; `null` deletes the override and an empty `intervals`
    object.
  - `access.getIntervalMinutes(chatId: string, homeId: string, registry?): number`
    — `chat.intervals?.[homeId] ?? home.notificationIntervalMinutes ?? 0`.
  - `access.listGroups(): Array<{ chatId: string, homes: Array<{ homeId, subscribed: boolean, intervalMinutes: number }> }>`
    — negative IDs with a current grant, sorted by chat ID.
  - `isIntervalMinutes(value)` in validation: integer `0` or `5..10080`.

- [ ] **Step 1: Write failing tests**
  - chat-access
    `'chat interval overrides persist, survive toggles and reset to the home default'`:
    homes `[{ id: '1', notificationIntervalMinutes: 60 }]`; authorize `7`;
    `getIntervalMinutes('7','1') === 60`; `setInterval('7','1',30)` → `30`;
    subscription off/on → still `30`; reopen store → still `30`;
    `setInterval('7','1',null)` → `60` and `readChats().chats['7']` has no
    `intervals`; unauthorized chat → rejects `/Access denied/`;
    `access.recipients` output keys unchanged
    (`chatId, generation, subscriptionId, locale`).
  - chat-access `'listGroups returns approved groups only'`: approve `-1007`,
    authorize private `7`, `setLocale('-2000','en')` (unapproved) →
    `listGroups()` returns only `-1007` with `subscribed`/`intervalMinutes`.
  - monitor-store: registry with `intervals: { '1': 4 }` and `{ '1': 10081 }`
    fails validation; `{ '1': 0 }`, `{ '1': 5 }` and a chat without the field
    load.

- [ ] **Step 2: Run**
      `node --import=extensionless/register --test tests/unit/chat-access.test.js tests/unit/monitor-store.test.js`
      Expected: FAIL (missing methods/field).

- [ ] **Step 3: Implement** validation (`intervals` optional on both legacy and
      current chat shapes: object of home ID → `isIntervalMinutes`) and the
      three access methods. `setInterval` writes through `store.updateChats` and
      re-checks authorization inside the updater like `setSubscription`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: store per-chat notification intervals`.

### Task 3: Per-chat recurring cadence

**Files:**

- Modify: `src/services/power/notifications.js:29-60,169-210`
- Modify: `src/services/monitor/runtime.js:103-112`
- Test: `tests/unit/power-notifications.test.js`

**Interfaces:**

- Consumes: `access.getIntervalMinutes(chatId, homeId, registry)` (Task 2).

- [ ] **Step 1: Write failing tests** (use `runtimeFixture`):
  - `'each chat follows its own recurring interval'`: home default `1`; second
    chat `8` authorized+subscribed with `setInterval('8','1',5)`. Advance 60 s
    ×5: chat `7` gets 5 periodic sends, chat `8` gets 1.
  - `'changing an interval restarts that chat cadence'`: default `1`; after
    first send, `setInterval('7','1',5)`; advancing 60 s ×4 sends nothing, the
    5th minute sends one.
  - `'interval zero stops recurring updates but keeps alerts'`:
    `setInterval('7','1',0)`; pending alert still sent; no periodic send.
  - `'a chat interval enables updates when the home default is off'`: no
    `notificationIntervalMinutes`, `intervalSeconds` 300, chat `setInterval 5` →
    after 5 minutes one periodic send (proves the per-minute timer runs).

- [ ] **Step 2: Run**
      `node --import=extensionless/register --test tests/unit/power-notifications.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `statusCadences`/`dueHomes` with a map
      keyed `${chatId}:${homeId}` → `{ intervalMs, anchor }`. In `pass`, always
      read the registry; for each home and each `access.recipients` entry take
      `getIntervalMinutes`; `0` → delete the cadence and skip; a different
      `intervalMs` → reset `{ intervalMs, anchor: now }`; due when
      `elapsed >= intervalMs` (keep the existing modulo coalescing). Drop map
      entries not seen in the pass. Call `getStatuses()` only when something is
      due. Runtime: start the per-minute timer whenever
      `60 % intervalSeconds !== 0`.

- [ ] **Step 4: Run** the same command, then the full suite
      `node .yarn/releases/yarn-4.18.0.cjs test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: per-chat recurring status cadence`.

### Task 4: `/notification_interval` command

**Files:**

- Modify: `src/api/bot/monitor/commands.js`
- Modify: `src/loaders/bot.js:95-105` (`setMyCommands`)
- Modify: `system/locales/bot/en.ftl`, `ru.ftl` (help text listing commands, new
  `interval_*` replies)
- Test: `tests/unit/monitor-commands.test.js`

**Interfaces:**

- Consumes: `access.setInterval`, `access.getIntervalMinutes` (Task 2).
- Produces:
  `parseIntervalArguments(text: string, homes): { minutes: number | null, home } | { error: 'usage' | 'not_found' }`
  exported from `src/api/bot/monitor/intervalArguments.js`, reused by Task 5.
  First token `default` → `null`; otherwise must match `/^\d+$/` and pass
  `isIntervalMinutes`; remainder is the home name; empty remainder allowed only
  with one home.

- [ ] **Step 1: Write failing tests** (use `notificationFixture`):
  - group `/notification_interval@power_test_bot 30 Family Home` after group
    approval → reply contains `30`;
    `access.getIntervalMinutes('-1007','1') === 30`.
  - unaddressed group form ignored (no reply); unauthorized chat → access denied
    reply.
  - `/notification_interval 30` (single home) works in private; `default`
    resets; `4`, `10081`, `abc`, empty → usage reply with `5` and `10080`;
    unknown home → `🔍 Home not found.`
  - `/notification_interval 0` → reply says recurring updates are off.

- [ ] **Step 2: Run**
      `node --import=extensionless/register --test tests/unit/monitor-commands.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement** the parser module and a `notification_interval`
      branch in `protectedCommands` (add to `monitorCommands`). Add Fluent keys
      `interval_set` (`$minutes`, `$home`), `interval_off` (`$home`),
      `interval_reset` (`$home`, `$minutes`), `interval_usage` in both
      languages, the command to user help texts and `setMyCommands`
      (`'Set recurring status interval'`).

- [ ] **Step 4: Run** the same test file, then
      `node .yarn/releases/yarn-4.18.0.cjs test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: notification interval command`.

### Task 5: Admin group management and docs

**Files:**

- Create: `src/api/bot/adminGroups.js`
- Modify: `src/api/bot/index.js` (register composer after admin commands)
- Modify: `system/locales/bot/en.ftl`, `ru.ftl` (`admin_help`, new
  `admin_groups_*`)
- Modify: `docs/monitor-design.md` (Telegram access section),
  `docs/operations.md` (commands)
- Test: `tests/unit/monitor-commands.test.js`

**Interfaces:**

- Consumes: `access.listGroups`, `access.setSubscription`, `access.setInterval`,
  `access.clearChats`, `access.isAuthorized` (Task 2), `parseIntervalArguments`
  (Task 4), `homeMonitor.getStatuses()` for home names.
- Produces:
  `createAdminGroupCommands({ access, admins, homeMonitor }): Composer`.
  Callback data: `grp:on:<chatId>:<homeId>`, `grp:off:<chatId>:<homeId>`,
  `grp:del:<chatId>`, `grp:delok:<chatId>`, `grp:cancel:<chatId>`.

- [ ] **Step 1: Write failing tests** (fixture with `admins: [7]`, private chat
      `7`; extend the fake API to answer `getChat` with
      `{ id, type: 'supergroup', title: 'Family' }` or throw for a chosen ID):
  - `/groups` with none → no-groups reply; with `-1007` approved → one
    `sendMessage` to chat `7` containing `Family`, `-1007`, home name, state and
    interval, keyboard with `grp:on:-1007:1` and `grp:del:-1007`.
  - `getChat` failure → card contains `-1007` and "unavailable".
  - toggle callback → subscription on, `answerCallbackQuery` with
    `🔔 Notifications enabled.`, `editMessageText` on chat `7`; assert no API
    call has `chat_id === -1007`.
  - delete → confirm edit with `grp:delok`/`grp:cancel`; cancel restores the
    card; delok → `access.isAuthorized('-1007') === false`, edit says deleted.
  - stale card after delete → answer "group not found", registry unchanged.
  - non-admin sender, or callback whose message chat is a group → refused, no
    state change.
  - `/group_on -1007`, `/group_off -1007 Family Home`,
    `/group_interval -1007 30`, `/group_interval -1007 default`; positive ID →
    usage; unapproved group → not found; no call targets `-1007`.

- [ ] **Step 2: Run**
      `node --import=extensionless/register --test tests/unit/monitor-commands.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement** the composer: admin + private guards as in
      `adminCommands.js`; a `renderGroupCard(group, title, homes, t)` returning
      `{ text, reply_markup }`; titles via `ctx.api.getChat` inside try/catch.
      Toggle/delete/cancel edit the clicked message with `editMessageText`.
      Fluent keys for card lines, buttons, confirmation, deleted, not found,
      usages in both languages; extend `admin_help`. Update both docs.

- [ ] **Step 4: Run full verification**

  ```powershell
  $env:HUSKY = '0'
  node .yarn/releases/yarn-4.18.0.cjs test
  node .yarn/releases/yarn-4.18.0.cjs check
  node .yarn/releases/yarn-4.18.0.cjs lint
  node .yarn/releases/yarn-4.18.0.cjs prettier
  ```

  Expected: all pass; lint/prettier clean.

- [ ] **Step 5: Commit** `feat: silent admin group management` (include the spec
      and plan files).
