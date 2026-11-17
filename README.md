# Home Power Status Monitor

A Telegram bot and interval worker that monitors selected EZVIZ cameras,
persists home power estimates and cumulative statistics, and serves authorized
chats.

Implemented: per-home provider polling, offline streak inference, atomic JSON
storage, persistent chat grants, brief `/status` and detailed `/status_full`
queries, subscriptions, outage and restoration alerts, bounded Telegram retries
and graceful shutdown. Polling is disabled by default. There is no HTTP server
or database service.

## Requirements and install

Node.js 24 is recommended. Package engines allow Node 22.13+, 24.x, or 26+,
matching retained dependencies. Verification used Node 24.12.0 on Windows. No
database, OpenAI, Groq or payment account is required.

From the repository root:

```powershell
$env:HUSKY = '0'
node .yarn/releases/yarn-4.18.0.cjs install --immutable
```

Yarn 4.18.0 is vendored. A working Yarn shim supports equivalent `yarn`
commands. `HUSKY=0` skips hook installation; omit it to configure local Git
hooks. The hook runs lint/tests and does not install dependencies.

## Configuration

Load order from `src` (later values win):

1. `.env`: shared defaults.
2. `.env.dev` for `NODE_ENV=dev`, or `.env.prod` for `NODE_ENV=prod`. Default
   `local` mode skips both server overlays.
3. `.env.local`: private machine-specific overrides.
4. Exported process variables override every file.

Shared non-secret defaults in `src/.env`, `src/.env.dev` and `src/.env.prod`
belong in Git. Keep credentials and private overrides in ignored local files,
such as `src/.env.local`. The worker loads `.env.local` after shared settings.
Tests set `NODE_ENV=test` and skip dotenv files.

For an existing installation, replace `NODE_ENV=development` with `dev` and
`NODE_ENV=production` with `prod`. The default is now `local`, which skips both
server overlays. Replace `CRON_CHECK_POWER_STATUS_TEMPLATE` with
`POWER_CHECK_INTERVAL_SECONDS`; the old cron expression is ignored.

| Variable                             | Default | Purpose                                               |
| ------------------------------------ | ------- | ----------------------------------------------------- |
| `NODE_ENV`                           | `local` | Mode: `local`, `dev`, or `prod`.                      |
| `DEFAULT_LOCALE`                     | `en`    | English or Russian.                                   |
| `TG_BOT_TOKEN`                       | empty   | Enable Telegram polling.                              |
| `TG_BOT_ACCESS_SECRET`               | empty   | Exact secret for each chat's `/secret` authorization. |
| `CRON_CHECK_POWER_STATUS_IS_ENABLED` | `0`     | Enable interval polling.                              |
| `POWER_CHECK_INTERVAL_SECONDS`       | `60`    | Poll and notification interval.                       |
| `POWER_OFF_FAILED_CHECKS`            | `3`     | Consecutive offline samples per device.               |

Configure `HOME_<id>_NAME`, per-home `EZVIZ_API_APP_KEY`, `EZVIZ_API_SECRET`,
`EZVIZ_API_BASE_URL`, and `DEVICE_<id>_HOME_<id>_TYPE/NAME/SERIAL` as shown in
the template. NAME selects the camera exactly; SERIAL is optional. Set
`HOME_<id>_POWER_OFF_OFFLINE_DEVICE_COUNT=-1` to require all configured devices
instead of the default one. Empty homes remain unknown. Only the Europe origin
is supported. Retired cron expressions are ignored; global EZVIZ keys are
rejected.

Keep credentials and home-specific settings in ignored local env files. Use the
commented home/device block in `src/.env` as a configuration example.

## Run

```powershell
node .yarn/releases/yarn-4.18.0.cjs start

# Prod overlay:
$env:NODE_ENV = 'prod'
node .yarn/releases/yarn-4.18.0.cjs start
```

Run in local mode for development:

```shell
pm2 start server.json
```

Run in dev mode on the dev server:

```shell
pm2 start server.json --env dev
```

Run in prod mode on the prod server:

```shell
pm2 start server.json --env prod
```

PM2 uses `env` by default and selects `env_dev` or `env_prod` with `--env`. See
[PM2 environment selection](https://github.com/Unitech/pm2/wiki/Applications-Declaration).
`server_local.json` watches source and locale changes and defaults to `local`.
Both manifests support the same `--env` switches. All manifests identify the
same single worker; use one manifest per running storage directory. `local` and
`dev` enable debug logging; `prod` disables it. Set mode through PM2 or exported
`NODE_ENV`, before loading dotenv files.

The root script runs from `src`, as required by storage/localization paths. If
both Telegram and cron are disabled, no background service keeps the process
alive, so it exits normally.

In groups, `/help@your_bot_username` works; unrelated messages are ignored.
Telegram language is used when supported, with `DEFAULT_LOCALE` as fallback.

Run one check without enabling its schedule:

```powershell
Set-Location src
node --import=extensionless/register cron/checkPowerStatus/manualStart.js
```

The first automatic poll runs after one interval. Scheduled ticks do not
overlap; concurrent manual calls share the accepted round. The standalone
launcher cannot run while a worker owns storage and never sends Telegram.
Separate manual processes reset offline streaks.

Authorized `/status` and `/status_full` refresh all homes immediately before
replying; a named query shows only the requested home. Scheduled ticks skip
checks while all JSON `sample.observedAt` timestamps are less than 60 seconds
old. Unknown observations also update this timestamp. Explicit status/manual
checks bypass the age gate and share any in-flight round.

Authorize each chat with `/secret <value>`. Use `/status [home name]`, or
`/status_full [home name]` for formatted history, totals and device diagnostics,
`/on_notification home name`, `/off_notification home name`; groups require
`/status@your_bot_username` and equivalent addressed forms. Grants survive a
restart with the same secret. Secret rotation invalidates grants while retaining
preferences. All group members share the chat's access and subscriptions.

JSON records live in `volume/homes/<id>.json` and `volume/chats.json`. Only one
process may own `volume/.monitor.lock`. For stale-lock recovery, first verify
all workers and PM2 watch restarts are stopped and the old process is gone, then
remove only its stale lock. Preserve data files. Windows PM2 manifests enable
`shutdown_with_message`; the worker handles that message with a bounded graceful
drain. Apply the updated manifest before testing watch restarts. Unknown/restart
gaps count as uncertain time; status timestamps are UTC observations, not
physical switch times. Initial off baselines alert; initial on baselines do not.
Delivery is at least once while pending, with a send/ack crash duplicate window
and a cap of 1000 pending deliveries per home. Dropped alerts are counted. See
[monitor behavior and operations](docs/monitor-design.md) for inference,
authorization, retry, uncertainty and shutdown details.

## Checks

Run from the repository root:

```powershell
node .yarn/releases/yarn-4.18.0.cjs test
node .yarn/releases/yarn-4.18.0.cjs lint
node .yarn/releases/yarn-4.18.0.cjs prettier
node .yarn/releases/yarn-4.18.0.cjs check
```

There is no compilation/bundle step. Tests use controlled subprocesses, mocked
Telegram, and local HTTP servers for the retained outbound request client. They
do not contact live Telegram or vendor accounts.

## Structure

- `src/app.js`: startup, shutdown and deadlines.
- `src/config`: environment loading and runtime settings.
- `src/loaders`: cron and optional Telegram runner.
- `src/cron/checkPowerStatus`: interval scheduler and manual launcher.
- `src/api/bot`: Telegram routes; there are no app/API server routes.
- `src/middlewares/bot`: update logging, backpressure and error handling.
- `src/services`: logger, cron tracking, Telegram queue and outbound HTTP
  client.
- `src/utils`: reusable common, UTC/time, language, response and flow helpers.
- `system/locales/bot`: English and Russian Fluent strings.
- `volume`: ignored JSON home history, chat registry and ownership lock.
- `server.json`: optional single-process PM2 example, with a 40-second stop
  allowance for the application's 35-second shutdown deadline.

No deployment workflow is configured. Run exactly one writer per storage
directory. See [monitor design](docs/monitor-design.md) and
[development guide](docs/development.md).
