# Development guide

## Current architecture

The process starts configured cron tasks and optional Telegram polling. There is
no HTTP server. Bot routes and middleware live under `src/api/bot` and
`src/middlewares/bot`.

`checkPowerStatus` polls through an injected shared coordinator. The store opens
and access initializes before producers start. Scheduled ticks skip busy work;
manual calls coalesce. Notification delivery runs independently of polling and
never holds the storage mutation queue during a network request.

Authorized `/status` and `/status_full` commands share a coordinator with
scheduled checks. The first check after startup polls even if the previous
process saved a recent observation. Later requests join an in-flight round or
use cached results within the cooldown. See the
[monitor design](monitor-design.md#telegram-access-and-delivery) for cadence
details.

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

See [configuration](operations.md#configuration) for environment modes,
precedence, and private settings. Track shared non-secret defaults in
`src/.env`, `src/.env.dev`, and `src/.env.prod`. Runtime storage belongs under
the ignored `volume` directory.

Local editor/agent settings, migration notes, rollback snapshots, caches and
logs are excluded from the public source tree. Keep these exclusions when adding
files. Review the staged paths before publishing a commit.

## Validation

Yarn 4.18.0 is vendored. The install command in the
[quick start](../README.md#quick-start) installs local Git hooks. To skip hooks,
set `HUSKY=0` in your shell before running the install command. The pre-commit
hook runs lint and tests. A working Yarn shim supports equivalent `yarn`
commands.

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

Use Node.js 24 for development. The engines in [package.json](../package.json)
also allow Node.js 22.13+ in the 22.x series and Node.js 26 or later. Live
provider connectivity, Telegram group behavior, and deployment need separate
acceptance checks before deployment.

## Monitor implementation

See [monitor behavior](monitor-design.md) for configuration, history/statistics,
access generations, subscriptions, durable delivery and stale-lock recovery.
Tests use temporary directories, fake clocks and fake transports. Keep test
preload isolation for all HOME_, DEVICE_, EZVIZ_, POWER_ variables and bot
secrets. No import-time singleton opens storage. The manual launcher shares
ownership rules and never attaches Telegram.

## Source layout

- `src/app.js` owns process startup, shutdown, and deadlines.
- `src/config` loads environment settings.
- `src/loaders` starts the scheduler and optional Telegram polling.
- `src/cron/checkPowerStatus` contains the interval task and manual launcher.
- `src/api/bot` and `src/middlewares/bot` handle Telegram commands and updates.
- `src/services` contains monitor logic, storage, and external clients.
- `src/utils` contains shared helpers.
- `system/locales/bot` contains English and Russian Fluent strings.
- `tests/unit` and `tests/fixtures` contain tests and controlled subprocesses.

See [module boundaries](module-boundaries.md) for import conventions and
[operations](operations.md#pm2-and-storage) for PM2 manifests.
