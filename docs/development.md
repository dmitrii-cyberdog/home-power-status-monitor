# Development guide

## Current architecture

The process starts configured cron tasks and optional Telegram polling. There is
no HTTP server. Bot routes and middleware live under `src/api/bot` and
`src/middlewares/bot`.

`checkPowerStatus` polls through an injected shared coordinator. The store opens
and access initializes before producers start. Scheduled ticks skip busy work;
manual calls coalesce. Notification delivery runs independently of polling and
never holds the storage mutation queue during a network request.

Authorized `/status` and `/status_full` commands force a shared monitoring round
and reply after commit. Scheduled rounds skip while every persisted
`sample.observedAt` is less than 60 seconds old; missing, older or future
timestamps allow polling. The existing interval still determines when scheduled
ticks run.

`/status` shows current power, duration since detection and the last opposite
state detection. `/status_full` adds formatted history, sampled totals and safe
device diagnostics. Dynamic text is HTML-escaped; each chunk has balanced tags.
Unknown provider results never populate decisive state or invent past outages.
Polling remains opt-in through `CRON_CHECK_POWER_STATUS_IS_ENABLED=1`.

Shutdown stops intake and timers, drains accepted work and acknowledgement
writes, drains Telegram, closes storage, then HTTP agents and logging. A
timed-out writer retains the lock. See [monitor operations](monitor-design.md).
Windows PM2 uses IPC `shutdown` messages; both manifests enable
`shutdown_with_message`. Keep the 40-second PM2 timeout above the worker's
35-second hard deadline. Load the updated manifest to apply this PM2 setting.

## Local configuration and data

Configuration defaults to `NODE_ENV=local`: load `.env`, then `.env.local` from
`src`. `NODE_ENV=dev` inserts `.env.dev` between them; `NODE_ENV=prod` inserts
`.env.prod`. Exported variables override all files. Only `local`, `dev`, `prod`
and the isolated `test` mode are accepted. Tests use `NODE_ENV=test` and skip
dotenv files.

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
Telegram group behavior and deployment need separate acceptance checks before
deployment.

## Monitor implementation

See [monitor behavior](monitor-design.md) for configuration, history/statistics,
access generations, subscriptions, durable delivery and stale-lock recovery.
Tests use temporary directories, fake clocks and fake transports. Keep test
preload isolation for all HOME_, DEVICE_, EZVIZ_, POWER_ variables and bot
secrets. No import-time singleton opens storage. The manual launcher shares
ownership rules and never attaches Telegram.

## PM2 modes

Run from the repository root:

```shell
pm2 start server.json
pm2 start server.json --env dev
pm2 start server.json --env prod
```

These select `local`, `dev` and `prod`, respectively. The alternate manifest
`server_local.json` defaults to `local` and watches source and locale changes.
Both manifests use one fork process and the same app name. Do not start multiple
workers against the same storage directory. Local and dev modes enable debug
logs. Mode must be selected before dotenv loading.
