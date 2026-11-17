# Status, Notification Buttons, and Chat Administration Implementation Plan

> Implemented locally. Verification passed for 124 tests, lint, formatting, and
> syntax checks. Registry clears were exercised with temporary test data.

## Goal

Improve the brief power summary, let users manage notifications from a named
home's private status reply, and let configured admins clear saved chat records.

## Architecture

Keep formatting in the status renderer, Telegram interactions in the bot routes,
and registry reads and writes in `chatAccess` through the existing monitor
store. Use grammY's built-in inline keyboards and the existing Fluent locales.
Use Node.js 24 and Yarn 4.18.0. The existing
[monitor design](../../monitor-design.md) describes the storage and notification
contracts.

## Proposed behavior

- Give every home in brief `/status` a bold heading and a blank line before the
  power information. Use ⚡ for electricity, ✅ for on, and ❌ for off. An
  unknown current state uses ⚡ and the existing localized unknown text. Keep
  the existing duration and last-observed or last-transition information.
- Attach one **Enable notifications** or **Disable notifications** button to the
  last message of a private `/status <home name>` reply. The label reflects that
  chat's stored subscription for that home. Bare `/status`, group replies, and
  `/status_full` have no button. Keep the full report's existing layout.
- A tap applies the action written on the button. After the save, acknowledge
  the result and update the button to reflect the saved state. A repeated tap on
  an older **Enable notifications** button cannot disable notifications.
- Use the `TG_ADMIN_1` through `TG_ADMIN_50` convention from
  `intelligent-calories`. Admin identity comes from the Telegram sender's user
  ID. In a private bot chat, configured admins can run
  `/clear_chats -1001234567890` to remove one chat record or `/clear_chats all`
  to remove every chat record. Bare or invalid input returns usage. These
  commands require the configured admin role independently of `/secret`, so an
  admin can still use them after clearing their own grant.
- Each removed chat loses its authorization and subscriptions. It must run
  `/secret` again and opt back into notifications. Preserve the registry schema,
  secret verifier, and generation, along with home history and power statistics.
  Use the normal single-writer commit path for both clear scopes.

Example brief reply for an authorized named query in a private chat

```text
Family Home

⚡ ✅ Power on for 2 days 3 hours (since detection)
Last power off: 2026-11-17 18:10 UTC

[ Enable notifications ]
```

The bracketed line represents a Telegram button below the message.

## Task 1 — Brief status formatting

Files `src/api/bot/monitorMessages.js` and
`tests/unit/monitor-messages.test.js`.

- [x] Add failing renderer assertions for the blank line and emoji prefixes in
      on, off, and unknown summaries. Cover multiple homes and retain the
      existing escaping and message-length tests, including a split at the
      heading boundary. Verify the full renderer retains its current layout.
- [x] Apply the spacing and emoji to the brief renderer while sharing the
      existing duration, state, and transition formatting. Keep the 4,000-unit
      HTML message budget, valid tags, and existing home separators.
- [x] Run the focused monitor message tests.

## Task 2 — Private subscription button

Files `src/api/bot/monitorCommands.js`, `src/services/chatAccess.js`,
`src/loaders/bot.js`, both `system/locales/bot/*.ftl` files, and
`tests/unit/monitor-commands.test.js`.

- [x] Add failing bot-route tests using a temporary store and intercepted
      Telegram calls. Cover both initial labels, named private versus bare and
      group queries, one keyboard for a split reply, and click behavior. Verify
      duplicate actions, a wrong or removed home ID, group callbacks, a revoked
      chat, and acknowledgement of invalid subscription callbacks.
- [x] Add `access.isSubscribed(chatId, homeId)` using current authorization and
      the persisted subscription. Create and update the same localized keyboard
      from that result. Attach it only to the last reply chunk and check that
      the chat is still authorized after the named status refresh.
- [x] Add `callback_query` to the runner's existing `message` update allowlist.
      Route a compact callback such as `subscription:on:1` or
      `subscription:off:1` through grammY. Validate the action and home ID. Use
      the callback message's accessible private chat as the target and require
      its ID to match the sender's user ID. Recheck current chat authorization
      and reuse `access.setSubscription`, including its existing idempotent
      outcomes. Answer the callback with the localized result. Edit only the
      keyboard and skip a redundant edit when its markup already matches. A
      Telegram edit failure leaves the committed subscription available to a
      fresh `/status <home name>` query.
- [x] Run the focused bot-route and chat-access tests. Check command-line
      notification arguments and the existing reply prompts still work.

Reference
[grammY inline keyboards and callbacks](https://grammy.dev/plugins/keyboard).

## Task 3 — Admin configuration and registry clearing

Files `src/config/config.js`, `src/api/bot/index.js`,
`src/api/bot/adminCommands.js`, `src/loaders/bot.js`,
`src/services/chatAccess.js`, `src/services/monitorRecords.js`,
`src/services/powerNotifications.js`, `tests/unit/setup.js`,
`tests/unit/config.test.js`, `tests/unit/chat-access.test.js`,
`tests/unit/power-notifications.test.js`, `tests/unit/monitor-commands.test.js`,
both Fluent files, and the README.

- [x] Add failing config tests for sparse slots, duplicates, malformed values,
      and the empty default. Strip inherited `TG_ADMIN_*` variables from test
      fixtures. Read slots 1–50 after dotenv, accept only complete positive safe
      integers, deduplicate, and report invalid nonempty entries using the
      variable name alone. Document filled-in IDs in private settings such as
      `src/.env.local` and use empty examples in shared defaults.
- [x] Add failing tests for authorized private admins, ordinary
      secret-authorized users, group invocations, invalid input, a missing chat,
      and explicit `all`. Register the route in the bot composer and pass the
      admin allowlist from bot setup. Check `ctx.from.id` and private chat
      before touching the registry. Reuse the registry's signed, safe-integer
      chat ID validation. Report the removed count or the missing target after
      the save. Keep the admin command out of the general Telegram command menu.
- [x] Add failing service tests for one-chat and all-chat clears, persistence
      across reopening, preservation of home history, and reauthorization with
      the same secret. Cover a subscription write queued behind a clear and an
      old pending alert after a chat reauthorizes and resubscribes.
- [x] Implement `access.clearChats(target)`, where `target` is a validated chat
      ID or the literal `all`. Delete the selected entries inside
      `store.updateChats` and return the number removed after commit. Check the
      subscription grant again against the current registry inside the queued
      subscription write, so a clear cannot be undone by a previously queued
      subscription change. Verify the existing delivery identity check drops
      obsolete alerts on the next pass. Sends already accepted by the Telegram
      transport may still arrive.
- [x] Recheck authorization before sending status chunks after the asynchronous
      refresh. Match a failed alert's subscription identity inside its cleanup
      write so a delayed Telegram refusal cannot remove a new subscription.
- [x] Run the focused config, chat-access, bot-route, and delivery tests.
      Document both admin command forms and the need to reauthorize and
      resubscribe after clearing.

## Final verification

- [x] Run the repository's `test`, `lint`, `prettier`, and `check` commands.
      Exercise destructive paths only against temporary test registries.
- [x] Review private-chat checks, forged or repeated callbacks, and
      clear-versus-subscribe ordering. Apply the ECC security-review guidance to
      the authorization changes. Recommend a Codex Security diff scan before
      release.
