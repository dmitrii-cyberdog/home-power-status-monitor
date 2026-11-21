# Setup and operations

Start with the [quick start](../README.md#quick-start). Run the root start
command from the repository root. It sets the working directory to `src` so the
worker can find the configuration, locales, and storage. The worker uses local
JSON files and runs without an HTTP server or database.

## Configuration

The worker loads settings from `src` in increasing order of precedence.

1. `.env` provides shared defaults.
2. `.env.dev` applies in `dev` mode and `.env.prod` in `prod` mode. Default
   `local` mode skips both overlays.
3. `.env.local` holds private overrides.
4. Exported environment variables take precedence over all files.

Set `NODE_ENV` before starting the worker. Tests use `test` mode and skip dotenv
files. Keep credentials, home and device identifiers, and administrator IDs in
the ignored `src/.env.local` file.

| Variable                             | Default | Purpose                                                                  |
| ------------------------------------ | ------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                           | `local` | Select `local`, `dev`, or `prod`.                                        |
| `DEFAULT_LOCALE`                     | `ru`    | Fallback Telegram language. Set `en` for English.                        |
| `TG_BOT_TOKEN`                       | Empty   | Enable Telegram polling.                                                 |
| `TG_BOT_ACCESS_SECRET`               | Empty   | Authorize private chats with `/secret`.                                  |
| `TG_ADMIN_1` through `TG_ADMIN_50`   | Empty   | Allow listed Telegram user IDs to approve groups and clear chat records. |
| `CRON_CHECK_POWER_STATUS_IS_ENABLED` | `0`     | Set to `1` for scheduled checks.                                         |
| `POWER_CHECK_INTERVAL_SECONDS`       | `60`    | Scheduled check interval and base alert retry interval.                  |
| `POWER_OFF_FAILED_CHECKS`            | `3`     | Consecutive offline observations required per device.                    |
| `POWER_CONTINUITY_GRACE_MINUTES`     | `5`     | Maximum gap between equal on/off results that keeps a duration.          |

Use the home and device block in [the shared defaults](../src/.env) as a
template. Set `HOME_<id>_NAME`, `HOME_<id>_EZVIZ_API_APP_KEY`, and
`HOME_<id>_EZVIZ_API_SECRET` for each monitored home. For each camera, set
`DEVICE_<deviceId>_HOME_<homeId>_TYPE=ezviz` and its exact `NAME`. Add `SERIAL`
to cross-check the device identity. The supported EZVIZ base URL is
`https://ieuopen.ezvizlife.com` and is used by default.

- `HOME_<id>_POWER_OFF_OFFLINE_DEVICE_COUNT` defaults to one qualifying device.
  Set it to `-1` to require all configured devices. Homes with no devices stay
  unknown.
- `HOME_<id>_TIME_ZONE` controls timestamps in Telegram. Home 1 defaults to
  fixed `GMT+2` year-round. Other homes default to `UTC`. Use `UTC` or a fixed
  offset such as `GMT-3:30`. Stored timestamps use UTC.
- `HOME_<id>_NOTIFICATION_INTERVAL_MINUTES` sends recurring status to the home's
  existing subscribers. Use whole minutes. Omit it or set it to `0` to disable
  recurring updates. The first update is due one interval after the notification
  worker starts and uses cached status.

For older installations, use `NODE_ENV=dev` or `NODE_ENV=prod` and replace
`CRON_CHECK_POWER_STATUS_TEMPLATE` with `POWER_CHECK_INTERVAL_SECONDS`. The
retired cron expression is ignored. Global `EZVIZ_` variables are rejected.

## Telegram commands

| Command                         | Purpose                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `/secret <value>`               | Authorize the current private chat.                                                         |
| `/status [home name]`           | Show a brief power summary. A named query in a private chat includes a subscription button. |
| `/status_full [home name]`      | Show history, estimated totals, and device diagnostics.                                     |
| `/on_notification <home name>`  | Subscribe the current chat to alerts and any configured recurring updates.                  |
| `/off_notification <home name>` | Unsubscribe the current chat.                                                               |
| `/en` or `/ru`                  | Save the chat's language.                                                                   |

To set up a group, add the bot and use its setup message or
`/help@your_bot_username` to get the group ID. A configured admin runs
`/authorize_group <chat_id>` from a private chat with the bot. Verify the
negative group ID before granting access. Use addressed commands such as
`/status@your_bot_username` in groups. All group members share access and
subscriptions. Use the access secret only in private chats.

Grants survive restarts with the same secret. Secret rotation invalidates grants
and retains preferences. If a secret was posted in a group, rotate it and
reauthorize trusted chats.

In private chat, admins can use `/admin` to list admin commands.
`/clear_chats <chat_id>` clears one chat and `/clear_chats all` clears the
registry. Cleared chats must authorize again and re-enable subscriptions. Home
history and power statistics are preserved.

With `TG_BOT_TOKEN` and `TG_ADMIN_1` set, the primary admin receives startup
notices and brief error alerts. The admin must first open a private chat with
the bot and send `/start`. Detailed diagnostics stay in local logs.

## Polling and manual checks

The first scheduled tick runs after one interval. Telegram status commands can
also request a check with scheduled polling disabled. Scheduled checks and
status commands share a cadence and join any round in progress. See the
[monitor design](monitor-design.md#telegram-access-and-delivery) for refresh
rules.

To force a single check, stop the running worker first and run these commands
from the repository root.

```sh
cd src
node --import=extensionless/register cron/checkPowerStatus/manualStart.js
```

The standalone launcher writes observations but sends no Telegram messages.
Separate runs reset offline streaks. When both Telegram and scheduled polling
are disabled, the regular worker exits normally.

## PM2 and storage

Run the command for your chosen mode from the repository root.

```sh
pm2 start server.json
pm2 start server.json --env dev
pm2 start server.json --env prod
```

These commands select `local`, `dev`, and `prod`. The alternate
`server_local.json` also defaults to `local` and watches source and locale
changes. Local and dev modes enable debug logs. In local mode, successful HTTP
requests can log structured JSON response data. The logger redacts credential
fields such as `accessToken` and `appSecret`. Device names and serials can
appear in local logs. Run one worker per storage directory.

The worker stores home records in `volume/homes/<id>.json` and chat records in
`volume/chats.json`. See
[ownership and shutdown](monitor-design.md#ownership-and-shutdown) for
stale-lock recovery and PM2 shutdown behavior.

## GitHub Actions deployment

The [deployment workflow](../.github/workflows/deploy.yml) runs on pushes to
`master`. After tests pass, it deploys the tested commit to
`~/projects/home-power-status-monitor` and starts or restarts the PM2 worker in
`prod` mode.

Set the `SSH_USER`, `SSH_KEY`, and `SERVER_PROD_MAIN_1` GitHub Actions secrets
for the production deployment. `SSH_KEY` is the SSH private key and
`SERVER_PROD_MAIN_1` is the host. The workflow collects the host key with
`ssh-keyscan`. Node.js 24 and PM2 must be available to the server's SSH login
shell. Place production settings in
`~/projects/home-power-status-monitor/src/.env.local` before the first deploy.
New server checkouts use HTTPS. Existing checkouts can use HTTPS or SSH for the
same repository.
