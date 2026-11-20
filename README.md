# Home Power Status Monitor

A self-hosted Telegram bot that estimates home electricity status from selected
EZVIZ cameras. It sends outage and restoration alerts, can send periodic status
updates, and stores power history locally as JSON.

Use Node.js 24, an EZVIZ Europe API app with access to your cameras, and a
Telegram bot token. An internet outage can look like a power outage.

## Quick start

1. Clone the repository and install dependencies from its root.

   ```sh
   git clone https://github.com/dmitrii-cyberdog/home-power-status-monitor.git
   cd home-power-status-monitor
   node .yarn/releases/yarn-4.18.0.cjs install --immutable
   ```

2. Create `src/.env.local`. Set `TG_BOT_TOKEN` and a private
   `TG_BOT_ACCESS_SECRET`. Copy the commented home and camera settings from
   [the example](src/.env), uncomment them, and fill in your EZVIZ credentials
   and exact camera name. Set `CRON_CHECK_POWER_STATUS_IS_ENABLED=1` for
   automatic checks and outage alerts.

3. Start the worker from the repository root.

   ```sh
   node .yarn/releases/yarn-4.18.0.cjs start
   ```

4. In a private chat with the bot, send `/secret <value>` using your access
   secret. Send `/status` for a summary, `/status_full` for detailed history,
   and `/on_notification <home name>` to subscribe.

## Documentation

- [Setup and operations](docs/operations.md) covers configuration, Telegram
  groups, manual checks, PM2, and deployment.
- [Monitor design](docs/monitor-design.md) explains power inference, storage,
  and alert delivery.
- [Development guide](docs/development.md) covers the source layout and checks.
