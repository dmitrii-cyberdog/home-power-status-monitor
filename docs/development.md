# Development guide

## Current architecture

The process starts configured cron tasks and optional Telegram polling. There is
no HTTP server. Bot routes and middleware live under `src/api/bot` and
`src/middlewares/bot`.

`checkPowerStatus` is a disabled placeholder. Its scheduler uses UTC and
prevents overlapping scheduled runs. Its body currently returns an explicit
not-implemented result, without polling devices or sending notifications.

Shutdown stops cron schedules, waits for accepted bot/cron work, drains Telegram
API calls, closes outbound request agents and flushes logging. A bounded
deadline prevents shutdown from hanging indefinitely.

The generic outbound HTTP client, logger and time/language helpers can be reused
by future provider adapters. They do not require a database.

## Local configuration and data

Configuration loads `.env`, then `.env.dev` or `.env.prod`, then `.env.local`
from `src`. Exported variables override all files. Export `NODE_ENV=production`
to select the production overlay. Tests use `NODE_ENV=test` and skip dotenv
files.

Only `src/.env.example` belongs in source control. Keep credentials, device IDs,
home names, chat IDs and other private settings in ignored environment files.
Runtime storage belongs under the ignored `volume` directory.

Local editor/agent settings, migration notes, rollback snapshots, caches and
logs are excluded from the public source tree. Keep these exclusions when adding
files. Review the staged paths before publishing a commit.

## Validation

From the repository root, run:

```powershell
node .yarn/releases/yarn-4.18.0.cjs test
node .yarn/releases/yarn-4.18.0.cjs lint
node .yarn/releases/yarn-4.18.0.cjs prettier
node .yarn/releases/yarn-4.18.0.cjs check
```

There is no transpilation/build step. Tests cover configuration precedence,
localization, queues, logging, cron lifecycle, controlled worker
startup/shutdown and the outbound HTTP client using local test servers. They do
not contact live Telegram or device-provider accounts.

Use Node.js 24 for development. Supported engine declarations do not imply that
every platform or Node version has been tested. Live provider connectivity,
Telegram group behavior and deployment need separate acceptance checks when
those features are introduced.

## Planned work

See [the monitor design](monitor-design.md) for provider integration, home-state
inference, JSON persistence, notifications and group authorization requirements.
