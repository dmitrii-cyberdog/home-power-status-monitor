# Monitor modules and chat language implementation plan

Use Superpowers executing-plans or subagent-driven-development for
implementation. Specialist guidance used for this design came from ECC
backend-patterns.

## 1. Restore the public module boundaries

- [ ] Inventory imports in source, tests, and subprocess fixtures. Record
      existing module-load failures first.
- [ ] Populate the monitor and power service indexes and the monitor route index
      with exports from their moved files. Re-export service namespaces through
      `src/services/index.js`. Preserve existing logger exports.
- [ ] Update external imports throughout the project. Follow
      [the reusable convention](../../module-boundaries.md). Audit cycles and
      import-time configuration, especially where services currently depend on
      bot presentation code.
- [ ] Verify the normal bot and worker entry points load under the isolated test
      environment.

## 2. Make language a durable chat preference

- [ ] Add routing and delivery regressions. An English-account user selects /ru,
      receives one Russian confirmation, then receives Russian status replies
      and outage and restoration alerts. Repeat in reverse with /en. Cover a
      group with mixed account languages, restart, queued alerts, and separate
      chats.
- [ ] Register both commands and synchronize menu, help, and Fluent text.
      Persist the selection by chat ID before replying in the selected language.
      Keep language selection independent of access grants and subscriptions.
- [ ] Resolve the chat preference before translating each update. Preserve it
      across authorization, group approval, and subscription changes. Use
      account language only as an initial fallback before a chat has a
      preference. Treat existing saved locales as preferences for compatibility.
- [ ] Resolve the current authorized recipient's locale when sending each alert,
      including retries of existing queued deliveries. Preserve durable delivery
      and subscription checks.

## 3. Simplify monitor messages

- [ ] Run monitor message tests before moving code. Move monitor-specific
      status, detailed status, and alert formatting to the monitor service.
      Leave command parsing, keyboards, and replies in bot routes.
- [ ] Extract escaping and length-limited chunking into focused utility
      functions. Keep HTML status chunks balanced and plain alerts readable.
      Replace nested conditional spreads with named sections or straight-line
      assembly.
- [ ] Check existing English and Russian output, empty homes, unknown
      observations, long device names, HTML entities, emoji, and the 4,000-unit
      chunk limit.

## 4. Separate record construction and validation

- [ ] Keep factories in monitor/records.js. Move record validators and their
      private predicates to monitor/validation.js. Expose validation through the
      service index for external callers such as admin commands.
- [ ] Add field-level comments at the canonical record definitions, including
      nested statistics, observations, deliveries, and chat entries. Explain
      units, null values, continuity, accounting timestamps, and delivery
      identity using the actual writers.
- [ ] Preserve on-disk keys and existing accepted record shapes. Verify existing
      JSON fixtures still load, invalid records still fail, and unrelated
      updates retain saved preferences.

## Verification

- [ ] Run targeted routing, chat-access, notification, message, history, and
      store tests after each change. Use isolated test data and mocked Telegram
      calls.
- [ ] Run the full repository check from the root with
      `node .yarn/releases/yarn-4.18.0.cjs check`. Review the diff against the
      user's existing file moves.
