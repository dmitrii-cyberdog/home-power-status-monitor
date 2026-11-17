# Home Power Status Monitor

These instructions apply to the entire repository.

## Project context

This is a native ESM Node.js bot/cron worker using Yarn 4.18.0 and grammY. Use
Node.js 24 for development; package engines reflect retained dependency
requirements. Extensionless imports are enabled with
`--import=extensionless/register`.

The application must run with `src` as its working directory. Paths to `system`
and `volume` depend on that directory. The root start script and PM2 example
already set it.

The worker implements EZVIZ polling, electricity inference, JSON history,
secret-authorized home commands and durable notifications. See
`docs/monitor-design.md`.

## Repository map

- `src/app.js`: process lifecycle and bounded graceful shutdown.
- `src/config`: environment loading and runtime configuration.
- `src/loaders`: cron scheduler and optional Telegram polling runner.
- `src/cron/checkPowerStatus`: interval schedule, shared coordinator and manual
  launcher.
- `src/api/bot`: bot start/help commands; authorized monitor commands; there is
  no HTTP server.
- `src/middlewares/bot`: update logging, bot backpressure and errors.
- `src/services`: logger, cron tracking, Telegram setup/queue and generic HTTP
  request transport.
- `src/utils`: reusable common, time, language, response and flow utilities.
- `system/locales/bot`: English and Russian Fluent messages.
- `tests/unit`, `tests/fixtures`: automated tests and controlled subprocesses.
- `volume`: ignored JSON history, chat registry and exclusive ownership lock.

## Commands

Run dependency and validation commands from the repository root:

```powershell
$env:HUSKY = '0'
node .yarn/releases/yarn-4.18.0.cjs install --immutable
node .yarn/releases/yarn-4.18.0.cjs test
node .yarn/releases/yarn-4.18.0.cjs lint
node .yarn/releases/yarn-4.18.0.cjs prettier
node .yarn/releases/yarn-4.18.0.cjs check
node .yarn/releases/yarn-4.18.0.cjs start
```

A working Yarn shim supports equivalent `yarn` commands. There is no compilation
step. Use scoped ESLint and Prettier checks for touched files.

## Conventions and scope

- Inspect referenced implementations and callers before claims or edits.
- Preserve useful comments and blank lines unless their code is removed.
- Use braces for every JS branch. Separate independent logical steps with blank
  lines and major sections with two standalone `//` lines.
- Preserve native ESM and extensionless imports.
- Keep business rules in services and external transport details at boundaries.
- Keep changes focused; do not add speculative providers or configuration.
- Validate real boundaries such as configuration, provider responses and files.
- Run the smallest meaningful checks, then required project checks before
  claiming completion. Report failures accurately.
- Use Superpowers for generic development workflows and ECC only for matching
  specialist guidance. Use Context7 when current library documentation is
  needed.

## Configuration, data and localization

- Default `NODE_ENV=local` loads `src/.env`, then `.env.local`. `NODE_ENV=dev`
  or `NODE_ENV=prod` inserts `.env.dev` or `.env.prod` before `.env.local`.
  Exported process variables take precedence. Use only `local`, `dev`, `prod`
  and isolated `test`; select the mode before dotenv loading.
- Tests use `NODE_ENV=test` and must never load private dotenv files.
- Keep credentials, home identifiers and local machine settings out of source
  control. Preserve current private settings unless their modification is
  authorized. Never print or commit credentials. Only `src/.env.example` is a
  public configuration template.
- The `checkPowerStatus` poller is disabled by default and uses interval
  scheduling. Timestamps are UTC; shutdown drains accepted operations before
  closing storage.
- Do not call Telegram or external providers during automated tests.
- Keep English and Russian Fluent keys synchronized and preserve variables/tags.
- Persist transition timestamps in UTC and keep uncertain observations separate
  from confirmed electricity state.
- JSON persistence requires one writer per persistent storage directory.

## Working tree safety

- Preserve unrelated tracked and untracked changes, personal settings and data.
- Ask before destructive operations outside an approved cleanup, pushes,
  PR/issue changes, deployments, or shared/production changes.
- Never bypass checks or discard unfamiliar work.
- Do not change Git history, branch configuration or remotes without
  authorization.
- This repository has no configured deployment workflow. Do not assume branch
  names imply permission to deploy.
