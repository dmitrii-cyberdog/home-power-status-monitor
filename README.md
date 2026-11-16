# Home Power Status Monitor

A Telegram bot and cron worker foundation for tracking home electricity through
external devices.

**Implemented:** optional Telegram polling with `/start` and `/help`, a
scheduled `checkPowerStatus` placeholder, logging/redaction, API throttling,
generic HTTP client utilities, and bounded graceful shutdown.

**Planned:** device providers, power inference, JSON home history, outage
notifications, authorized group queries by home name. The cron placeholder does
not check devices or send notifications. There is no Express server or HTTP API.

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
2. `.env.dev` by default, or `.env.prod` with exported `NODE_ENV=production`.
3. `.env.local`: private machine-specific overrides.
4. Exported process variables override every file.

Use `src/.env.example` as a template without overwriting existing private
values. Real env files are ignored by Git. Tests set `NODE_ENV=test` and skip
dotenv files.

| Variable                             | Default       | Purpose                                                 |
| ------------------------------------ | ------------- | ------------------------------------------------------- |
| `NODE_ENV`                           | `development` | Export before startup to select development/production. |
| `DEFAULT_LOCALE`                     | `en`          | Fallback Telegram locale: `en` or `ru`.                 |
| `TG_BOT_TOKEN`                       | empty         | Enables Telegram polling when supplied.                 |
| `CRON_CHECK_POWER_STATUS_IS_ENABLED` | `0`           | Set to `1` to schedule the placeholder.                 |
| `CRON_CHECK_POWER_STATUS_TEMPLATE`   | `* * * * *`   | UTC cron expression, once a minute by default.          |

Keep credentials and home-specific settings in ignored env files. Only
`src/.env.example` is a public configuration template.

## Run

```powershell
node .yarn/releases/yarn-4.18.0.cjs start

# Production overlay:
$env:NODE_ENV = 'production'
node .yarn/releases/yarn-4.18.0.cjs start
```

The root script runs from `src`, as required by storage/localization paths. If
both Telegram and cron are disabled, no background service keeps the process
alive, so it exits normally.

In groups, `/help@your_bot_username` works; unrelated messages are ignored.
Telegram language is used when supported, with `DEFAULT_LOCALE` as fallback.

Run the placeholder once without enabling its schedule:

```powershell
Set-Location src
node --import=extensionless/register cron/checkPowerStatus/manualStart.js
```

`checkPowerStatus` currently returns an explicit not-implemented result. Its
scheduled executions do not overlap. Shutdown stops schedules, waits for
accepted cron/bot work, drains Telegram calls and closes shared resources.

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
- `src/cron/checkPowerStatus`: schedule, placeholder body and manual launcher.
- `src/api/bot`: Telegram routes; there are no app/API server routes.
- `src/middlewares/bot`: update logging, backpressure and error handling.
- `src/services`: logger, cron tracking, Telegram queue and outbound HTTP
  client.
- `src/utils`: reusable common, UTC/time, language, response and flow helpers.
- `system/locales/bot`: English and Russian Fluent strings.
- `volume`: ignored runtime storage; currently unused.
- `server.json`: optional single-process PM2 example, with a 40-second stop
  allowance for the application's 35-second shutdown deadline.

No deployment workflow is configured. Run one writer per storage directory when
JSON persistence is implemented. See [monitor design](docs/monitor-design.md)
and [development guide](docs/development.md).
